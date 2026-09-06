import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Agent, AgentRequest, AgentResult, ModelSpend } from "../types.js";

/** 노드의 권한 경계를 툴 화이트리스트로 번역합니다. */
const TOOLS = {
  "read-only": ["Read", "Glob", "Grep"],
  write: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
} as const;

export const claudeAgent: Agent = {
  name: "claude",

  async run(req: AgentRequest): Promise<AgentResult> {
    const started = Date.now();
    const abort = new AbortController();
    const timer = req.timeoutMs
      ? setTimeout(() => abort.abort(), req.timeoutMs)
      : undefined;

    let sessionId: string | undefined;
    let text = "";
    let numTurns: number | undefined;
    let spend: ModelSpend[] = [];
    let ok = false;
    let error: string | undefined;

    try {
      const stream = query({
        prompt: req.prompt,
        options: {
          cwd: req.cwd,
          allowedTools: [...TOOLS[req.access]],
          // 쓰기 노드는 편집을 자동 승인해야 헤드리스로 돕니다.
          permissionMode: req.access === "write" ? "acceptEdits" : "default",
          abortController: abort,
          ...(req.resume ? { resume: req.resume } : {}),
          ...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
          ...(req.model ? { model: req.model } : {}),
        },
      });

      for await (const msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          sessionId = msg.session_id;
        } else if (msg.type === "result") {
          sessionId ??= msg.session_id;
          numTurns = msg.num_turns;
          ok = msg.subtype === "success" && !msg.is_error;
          if (msg.subtype === "success") text = msg.result;
          else error = msg.subtype;

          // SDK 주석 기준 modelUsage 가 토큰/비용 회계의 정본입니다.
          // (usage 는 메인 루프만 세고 서브에이전트를 누락)
          spend = Object.entries(msg.modelUsage).map(([model, u]): ModelSpend => ({
            model,
            usage: {
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              cacheReadInputTokens: u.cacheReadInputTokens,
              cacheCreationInputTokens: u.cacheCreationInputTokens,
            },
            costUsd: u.costUSD,
            costBasis: "reported",
          }));
        }
      }
    } catch (e) {
      error = abort.signal.aborted
        ? `timeout after ${req.timeoutMs}ms`
        : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }

    return {
      ok,
      text,
      durationMs: Date.now() - started,
      spend,
      ...(sessionId ? { sessionId } : {}),
      ...(numTurns !== undefined ? { numTurns } : {}),
      ...(error ? { error } : {}),
    };
  },
};
