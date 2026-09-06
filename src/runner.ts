import type {
  Agent, AgentName, AgentNode, DeterministicNode, ModelSpend, NodeName, RunOutcome, RunState,
} from "./types.js";
import { isTerminal } from "./types.js";
import { GRAPH, isAgentNode } from "./graph.js";
import type { NodeContext } from "./nodes/index.js";
import { agentFor } from "./adapters/index.js";
import { Semaphore } from "./limits.js";
import { totalCost } from "./pricing.js";
import { sh } from "./sh.js";
import type { RunLog } from "./events.js";

const now = () => new Date().toISOString();

/**
 * 그래프 실행기. 전체가 이 while 루프 하나입니다.
 * 제어 흐름은 전적으로 이 코드가 정하고, 모델은 노드 안에서만 판단합니다.
 */
export type Resolve = (name: AgentName) => Agent;

export async function runGraph(
  state: RunState,
  log: RunLog,
  /** 어댑터 해석기. 테스트에서 가짜 에이전트를 끼우기 위해 주입받습니다. */
  resolve: Resolve = agentFor,
): Promise<RunOutcome> {
  const sem = new Semaphore(state.config.maxConcurrent);
  const runStart = Date.now();

  await log.event({
    t: "run_started", ts: now(), runId: state.runId,
    config: state.config, task: state.task,
    workdir: state.workdir, branch: state.branch,
  });

  while (!isTerminal(state.node)) {
    const node = state.node as AgentNode | DeterministicNode;
    const agentName = isAgentNode(node) ? state.config.assignment[node] : null;
    const nodeStart = Date.now();
    const spend: ModelSpend[] = [];

    await log.event({
      t: "node_started", ts: now(), runId: state.runId,
      node, agent: agentName, attempt: state.attempt,
    });
    console.log(`▶ ${node}${agentName ? ` (${agentName})` : " [결정적]"} · 시도 ${state.attempt + 1}`);

    const ctx: NodeContext = {
      state,
      sh: (cmd) => sh(cmd, state.workdir),
      async agent(target, req) {
        const impl = resolve(state.config.assignment[target]);
        const prev = state.sessions[target];
        const res = await sem.run(() =>
          impl.run({
            ...req,
            cwd: state.workdir,
            timeoutMs: state.config.nodeTimeoutMs,
            // 같은 역할을 다시 부를 때 이전 컨텍스트를 이어받습니다.
            ...(prev ? { resume: prev } : {}),
          }),
        );
        if (res.sessionId) state.sessions[target] = res.sessionId;
        spend.push(...res.spend);
        return res;
      },
    };

    let next: NodeName;
    let error: string | undefined;
    try {
      next = await GRAPH[node](ctx);
    } catch (e) {
      error = e instanceof Error ? e.stack ?? e.message : String(e);
      next = "escalate";
    }

    const cost = totalCost(spend);
    state.totals.costUsd += cost;
    state.totals.durationMs = Date.now() - runStart;

    await log.event({
      t: "node_finished", ts: now(), runId: state.runId,
      node, agent: agentName, attempt: state.attempt,
      ok: !error, next, durationMs: Date.now() - nodeStart,
      spend, ...(error ? { error } : {}),
    });
    console.log(`  └▶ ${next}  ($${cost.toFixed(4)}, ${((Date.now() - nodeStart) / 1000).toFixed(1)}s)`);

    state.node = next;
    await log.snapshot(state);
  }

  const outcome: RunOutcome = state.node === "done" ? "merged" : "escalated";
  await log.event({
    t: "run_finished", ts: now(), runId: state.runId, outcome,
    durationMs: Date.now() - runStart,
    costUsd: state.totals.costUsd,
    attempts: state.attempt + 1,
  });
  return outcome;
}
