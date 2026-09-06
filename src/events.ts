import { appendFile, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent, RunState } from "./types.js";

const RUNS_DIR = "runs";

export function runDir(runId: string): string {
  return join(RUNS_DIR, runId);
}

/**
 * 이벤트는 append-only 로 쌓습니다. 스냅샷을 덮어쓰면
 * "3번째 시도에서 왜 실패했나" 가 사라져서 사후 비교가 불가능해집니다.
 *
 *   runs/<runId>/events.jsonl  ← 지표·대시보드의 원천 (불변)
 *   runs/<runId>/state.json    ← 재개용 최신 스냅샷 (파생물)
 */
export class RunLog {
  private constructor(private readonly dir: string) {}

  static async open(runId: string): Promise<RunLog> {
    const dir = runDir(runId);
    await mkdir(dir, { recursive: true });
    return new RunLog(dir);
  }

  async event(ev: RunEvent): Promise<void> {
    await appendFile(join(this.dir, "events.jsonl"), JSON.stringify(ev) + "\n", "utf8");
  }

  async snapshot(state: RunState): Promise<void> {
    await writeFile(join(this.dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
  }

  async artifact(name: string, body: string): Promise<void> {
    await writeFile(join(this.dir, name), body, "utf8");
  }
}

export async function readEvents(runId: string): Promise<RunEvent[]> {
  const raw = await readFile(join(runDir(runId), "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunEvent);
}

export async function readState(runId: string): Promise<RunState> {
  return JSON.parse(await readFile(join(runDir(runId), "state.json"), "utf8")) as RunState;
}
