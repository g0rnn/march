import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agent, AgentRequest, AgentResult, TokenUsage } from "../types.js";
import { estimatedSpend } from "../pricing.js";

/** codex 의 샌드박스 모드로 권한 경계를 번역합니다. */
const SANDBOX = { "read-only": "read-only", write: "workspace-write" } as const;

/** `codex exec --json` 이 stdout 에 흘리는 JSONL 이벤트 중 우리가 쓰는 것들. */
type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.completed"; usage: CodexUsage }
  | { type: string; [k: string]: unknown };

interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

function toTokenUsage(u: CodexUsage): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cached_input_tokens,
    cacheCreationInputTokens: u.cache_write_input_tokens,
    reasoningOutputTokens: u.reasoning_output_tokens,
  };
}

export const codexAgent: Agent = {
  name: "codex",

  async run(req: AgentRequest): Promise<AgentResult> {
    const started = Date.now();
    const outFile = join(tmpdir(), `myarch-codex-${randomUUID()}.txt`);
    const model = req.model ?? "codex-default";

    // 최종 응답은 JSONL 을 파싱하지 않고 -o 파일에서 읽습니다.
    // 이벤트 스트림 형식이 바뀌어도 결과 추출이 깨지지 않습니다.
    const common = [
      "--json",
      "--skip-git-repo-check",
      "-s", SANDBOX[req.access],
      "-C", req.cwd,
      "-o", outFile,
      ...(req.model ? ["-m", req.model] : []),
    ];
    const args = req.resume
      ? ["exec", "resume", ...common, req.resume, req.prompt]
      : ["exec", ...common, req.prompt];

    let sessionId: string | undefined;
    let usage: CodexUsage | undefined;
    let stderr = "";
    let timedOut = false;

    const exitCode = await new Promise<number | null>((resolve) => {
      // stdin 을 닫아야 codex 가 "Reading additional input from stdin" 으로 멈추지 않습니다.
      const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

      const timer = req.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, req.timeoutMs)
        : undefined;

      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: CodexEvent;
          try {
            ev = JSON.parse(line) as CodexEvent;
          } catch {
            continue; // JSONL 이 아닌 잡음 줄은 무시
          }
          if (ev.type === "thread.started") sessionId = (ev as { thread_id: string }).thread_id;
          else if (ev.type === "turn.completed") usage = (ev as { usage: CodexUsage }).usage;
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => { stderr += c; });

      child.on("error", () => { clearTimeout(timer); resolve(null); });
      child.on("close", (code) => { clearTimeout(timer); resolve(code); });
    });

    let text = "";
    try {
      text = (await readFile(outFile, "utf8")).trim();
    } catch {
      /* 프로세스가 죽었으면 파일이 없을 수 있습니다 */
    } finally {
      await rm(outFile, { force: true });
    }

    const ok = exitCode === 0 && !timedOut;
    const error = timedOut
      ? `timeout after ${req.timeoutMs}ms`
      : ok
        ? undefined
        : `codex exited ${exitCode}: ${stderr.trim().slice(-400)}`;

    return {
      ok,
      text,
      durationMs: Date.now() - started,
      // Codex 는 비용을 안 주므로 pricing.ts 단가표로 환산합니다 (costBasis: "estimated").
      spend: usage ? [estimatedSpend(model, toTokenUsage(usage))] : [],
      ...(sessionId ? { sessionId } : {}),
      ...(error ? { error } : {}),
    };
  },
};
