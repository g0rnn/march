import type { AgentNode, AgentRequest, AgentResult, NodeName, RunState } from "../types.js";
import { sh, type ShResult } from "../sh.js";

export interface NodeContext {
  state: RunState;
  /** 세마포어·이벤트 기록·비용 누적은 러너가 감쌉니다. */
  agent(node: AgentNode, req: Omit<AgentRequest, "cwd">): Promise<AgentResult>;
  /** 대상 레포에서 셸 명령 실행. */
  sh(cmd: string): Promise<ShResult>;
}

/** 노드는 다음에 갈 노드 이름을 리턴합니다. 이게 엣지입니다. */
export type NodeFn = (ctx: NodeContext) => Promise<NodeName>;

export { sh };
