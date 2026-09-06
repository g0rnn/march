import { spawn } from "node:child_process";

export interface ShResult {
  code: number | null;
  out: string;
  ok: boolean;
}

/** 결정적 노드용 셸 실행기. 에이전트를 거치지 않습니다. */
export function sh(cmd: string, cwd: string, timeoutMs = 10 * 60_000): Promise<ShResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => { out += c; });
    child.stderr.on("data", (c: string) => { out += c; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: out + String(e), ok: false }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, ok: code === 0 }); });
  });
}
