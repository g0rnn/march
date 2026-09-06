import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentName, RunConfig, RunState } from "./types.js";
import { ENTRY } from "./graph.js";
import { RunLog } from "./events.js";
import { runGraph } from "./runner.js";
import { report } from "./report.js";
import { sh } from "./sh.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function asAgent(v: string | undefined, dflt: AgentName): AgentName {
  if (v === undefined) return dflt;
  if (v !== "claude" && v !== "codex") throw new Error(`알 수 없는 에이전트: ${v}`);
  return v;
}

const USAGE = `
myarch — 그래프 기반 AI 개발 조직

  run     이슈 하나를 planner→coder→tester→reviewer→integrator 그래프로 처리
  report  runs/ 의 이벤트 로그를 집계해 설정별로 비교

사용법:
  npm run dev -- run --workdir <대상레포> --task <파일경로> [옵션]
  npm run dev -- report

옵션:
  --task-text <문자열>   파일 대신 인라인으로 요구사항 전달
  --branch <이름>        작업 브랜치 (기본: myarch/<uuid8>)
  --config-id <라벨>     비교 리포트에서 묶을 이름 (기본: default)
  --planner|--coder|--reviewer <claude|codex>   노드별 모델 배정
  --test <명령>          tester 노드가 실행할 명령 (기본: npm test)
  --max-attempts <n>     코더 재시도 상한 (기본: 3)
  --concurrent <n>       동시 에이전트 프로세스 상한 (기본: env MYARCH_MAX_CONCURRENT 또는 2)
  --timeout <초>         노드 하나의 상한 (기본: 900)
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "report") return report();
  if (cmd !== "run") { console.log(USAGE); process.exitCode = cmd ? 1 : 0; return; }

  const workdir = flag(argv, "workdir");
  if (!workdir) throw new Error("--workdir 는 필수입니다 (에이전트가 작업할 대상 저장소)");

  const taskFile = flag(argv, "task");
  const taskText = flag(argv, "task-text");
  if (!taskFile && !taskText) throw new Error("--task <파일> 또는 --task-text <문자열> 이 필요합니다");
  const task = taskText ?? (await readFile(taskFile!, "utf8"));

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + randomUUID().slice(0, 4);
  const branch = flag(argv, "branch") ?? `myarch/${runId.slice(-4)}`;

  const config: RunConfig = {
    configId: flag(argv, "config-id") ?? "default",
    assignment: {
      planner: asAgent(flag(argv, "planner"), "claude"),
      coder: asAgent(flag(argv, "coder"), "claude"),
      reviewer: asAgent(flag(argv, "reviewer"), "codex"), // 기본값은 교차검증
    },
    maxAttempts: Number(flag(argv, "max-attempts") ?? 3),
    maxConcurrent: Number(flag(argv, "concurrent") ?? process.env["MYARCH_MAX_CONCURRENT"] ?? 2),
    nodeTimeoutMs: Number(flag(argv, "timeout") ?? 900) * 1000,
    testCommand: flag(argv, "test") ?? "npm test",
  };

  // 대상 저장소에 작업 브랜치를 먼저 만들어 둡니다 (에이전트가 아니라 우리가).
  const br = await sh(`git checkout -b ${branch}`, workdir);
  if (!br.ok) throw new Error(`브랜치 생성 실패:\n${br.out}`);

  const state: RunState = {
    runId, config, task, workdir, branch,
    node: ENTRY, attempt: 0, reviews: [], sessions: {},
    startedAt: new Date().toISOString(),
    totals: { costUsd: 0, durationMs: 0 },
  };

  const log = await RunLog.open(runId);
  await log.artifact("task.md", task);

  console.log(`run ${runId} · config=${config.configId} · branch=${branch}`);
  console.log(`배정: ${JSON.stringify(config.assignment)}\n`);

  const outcome = await runGraph(state, log);
  console.log(`\n결과: ${outcome} · $${state.totals.costUsd.toFixed(4)} · runs/${runId}/`);
  if (outcome !== "merged") process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
