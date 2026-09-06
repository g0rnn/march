/**
 * 그래프 루프 검증. 모델을 부르지 않고 가짜 어댑터로 전이만 확인합니다.
 * 검증 대상: 되돌아가는 엣지, 재시도 상한, 이벤트 기록.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentResult, NodeName, RunConfig, RunState } from "./types.js";
import { ENTRY } from "./graph.js";
import { RunLog, readEvents, runDir } from "./events.js";
import { runGraph } from "./runner.js";
import { sh } from "./sh.js";

const RUN_ID = "smoke-run";

const result = (text: string): AgentResult => ({
  ok: true, text, durationMs: 1, sessionId: "fake-session",
  spend: [{
    model: "fake", costUsd: 0.01, costBasis: "reported",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  }],
});

/** planner/coder 는 아무거나, reviewer 는 승인 판정을 냅니다. */
const fake: Agent = {
  name: "claude",
  async run(req) {
    return result(req.prompt.includes("리뷰어") ? "좋음.\nVERDICT: APPROVE" : "완료");
  },
};

async function main() {
  // 실제 git 저장소를 하나 만들어 결정적 노드가 진짜로 돌게 합니다.
  const dir = await mkdtemp(join(tmpdir(), "march-smoke-"));
  await sh("git init -q && git commit -q --allow-empty -m init", dir);

  // 테스트 명령: 처음 2회는 실패, 3회째부터 통과 (되돌아가는 엣지를 강제)
  const counter = join(dir, ".n");
  await writeFile(counter, "0");
  const testCommand =
    `n=$(cat ${counter}); n=$((n+1)); echo $n > ${counter}; ` +
    `if [ $n -lt 3 ]; then echo "test failed (run $n)"; exit 1; else echo "ok"; fi`;

  const config: RunConfig = {
    configId: "smoke",
    assignment: { planner: "claude", coder: "claude", reviewer: "claude" },
    maxAttempts: 3, maxConcurrent: 2, nodeTimeoutMs: 30_000, testCommand,
  };
  const state: RunState = {
    runId: RUN_ID, config, task: "스모크 태스크", workdir: dir, branch: "smoke",
    node: ENTRY, attempt: 0, reviews: [], sessions: {},
    startedAt: new Date().toISOString(), totals: { costUsd: 0, durationMs: 0 },
  };

  // events.jsonl 은 append-only 이므로 재실행 시 이전 회차가 누적됩니다.
  // 실전 실행에서는 그게 옳지만, 스모크는 매번 깨끗한 상태에서 시작해야 합니다.
  await rm(runDir(RUN_ID), { recursive: true, force: true });
  const log = await RunLog.open(RUN_ID);
  const outcome = await runGraph(state, log, () => fake);

  const seq = (await readEvents(RUN_ID))
    .filter((e): e is Extract<typeof e, { t: "node_started" }> => e.t === "node_started")
    .map((e) => e.node);

  const expected: NodeName[] = [
    "planner", "coder", "tester", "coder", "tester", "coder", "tester",
    "reviewer", "integrator",
  ];

  const pass = JSON.stringify(seq) === JSON.stringify(expected);
  console.log("\n실제 전이:", seq.join(" → "));
  console.log("기대 전이:", expected.join(" → "));
  console.log(`재시도 횟수: ${state.attempt} (기대 2)`);
  console.log(`리뷰 승인: ${state.reviews.at(-1)?.approved} (기대 true)`);
  console.log(`최종: ${outcome} (원격 없는 저장소라 integrator 에서 escalated 가 정상)`);
  console.log(`누적 비용: $${state.totals.costUsd.toFixed(2)}`);

  const ok = pass && state.attempt === 2 && state.reviews.at(-1)?.approved === true;
  console.log(ok ? "\n✅ 그래프 루프 검증 통과" : "\n❌ 전이가 기대와 다름");
  process.exitCode = ok ? 0 : 1;
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
