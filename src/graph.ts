import type { AgentNode, DeterministicNode, NodeName } from "./types.js";
import { AGENT_NODES } from "./types.js";
import type { NodeFn } from "./nodes/index.js";
import { planner } from "./nodes/planner.js";
import { coder } from "./nodes/coder.js";
import { tester } from "./nodes/tester.js";
import { reviewer } from "./nodes/reviewer.js";
import { integrator } from "./nodes/integrator.js";

/**
 * 그래프 = 노드 이름 → 함수. 엣지는 각 함수가 리턴하는 다음 노드 이름.
 *
 *   planner ─▶ coder ─▶ tester ─┬─(pass)─▶ reviewer ─┬─(approve)─▶ integrator ─▶ done
 *                ▲              │                    │
 *                └──(fail)──────┘                    └──(changes)──┘
 *                       재시도 한도 초과 시 어느 쪽이든 ─▶ escalate
 *
 * 되돌아가는 엣지가 두 개(테스트 실패 / 리뷰 반려)이고, 둘 다
 * config.maxAttempts 로 상한이 걸려 있어 무한루프가 불가능합니다.
 */
export const GRAPH: Record<AgentNode | DeterministicNode, NodeFn> = {
  planner,
  coder,
  tester,
  reviewer,
  integrator,
};

export const ENTRY: NodeName = "planner";

export function isAgentNode(n: NodeName): n is AgentNode {
  return (AGENT_NODES as readonly string[]).includes(n);
}
