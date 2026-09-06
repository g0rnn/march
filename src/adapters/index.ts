import type { Agent, AgentName } from "../types.js";
import { claudeAgent } from "./claude.js";
import { codexAgent } from "./codex.js";

const REGISTRY: Record<AgentName, Agent> = {
  claude: claudeAgent,
  codex: codexAgent,
};

/** 그래프는 어느 어댑터인지 모른 채 AgentResult 만 봅니다. */
export function agentFor(name: AgentName): Agent {
  return REGISTRY[name];
}
