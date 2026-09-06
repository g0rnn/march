import { readdir } from "node:fs/promises";
import type { AgentName, NodeName, RunEvent } from "./types.js";
import { readEvents } from "./events.js";

interface RunSummary {
  runId: string;
  configId: string;
  outcome: string;
  costUsd: number;
  durationMs: number;
  attempts: number;
  /** 노드별 누적: 호출 횟수 / 시간 / 비용 */
  perNode: Map<NodeName, { calls: number; ms: number; usd: number; agent: AgentName | null }>;
  /** 비용이 추정치인 실행은 별표로 표시합니다. */
  hasEstimated: boolean;
}

async function summarize(runId: string): Promise<RunSummary | null> {
  let events: RunEvent[];
  try { events = await readEvents(runId); } catch { return null; }

  const s: RunSummary = {
    runId, configId: "?", outcome: "incomplete",
    costUsd: 0, durationMs: 0, attempts: 0,
    perNode: new Map(), hasEstimated: false,
  };

  for (const ev of events) {
    if (ev.t === "run_started") s.configId = ev.config.configId;
    else if (ev.t === "node_finished") {
      const cur = s.perNode.get(ev.node) ?? { calls: 0, ms: 0, usd: 0, agent: ev.agent };
      cur.calls++;
      cur.ms += ev.durationMs;
      for (const sp of ev.spend) {
        cur.usd += sp.costUsd;
        if (sp.costBasis === "estimated") s.hasEstimated = true;
      }
      s.perNode.set(ev.node, cur);
    } else if (ev.t === "run_finished") {
      s.outcome = ev.outcome;
      s.costUsd = ev.costUsd;
      s.durationMs = ev.durationMs;
      s.attempts = ev.attempts;
    }
  }
  return s;
}

const pad = (v: string | number, w: number) => String(v).padEnd(w);
const rpad = (v: string | number, w: number) => String(v).padStart(w);

export async function report(): Promise<void> {
  let ids: string[];
  try { ids = await readdir("runs"); } catch { ids = []; }

  const rows = (await Promise.all(ids.map(summarize))).filter((r): r is RunSummary => r !== null);
  if (rows.length === 0) {
    console.log("기록된 실행이 없습니다. 먼저 `npm run dev -- run ...` 을 돌리세요.");
    return;
  }

  console.log("\n실행별\n" + "─".repeat(84));
  console.log(pad("configId", 20) + pad("runId", 22) + pad("outcome", 12) + rpad("시도", 5) + rpad("초", 8) + rpad("USD", 10));
  console.log("─".repeat(84));
  for (const r of rows.sort((a, b) => a.configId.localeCompare(b.configId))) {
    console.log(
      pad(r.configId, 20) + pad(r.runId, 22) + pad(r.outcome, 12) +
      rpad(r.attempts, 5) + rpad((r.durationMs / 1000).toFixed(0), 8) +
      rpad(r.costUsd.toFixed(4) + (r.hasEstimated ? "*" : ""), 10),
    );
  }

  // 설정별 집계 — 이게 A/B 비교의 본체입니다.
  const byConfig = new Map<string, RunSummary[]>();
  for (const r of rows) byConfig.set(r.configId, [...(byConfig.get(r.configId) ?? []), r]);

  console.log("\n설정별 집계\n" + "─".repeat(84));
  console.log(pad("configId", 20) + rpad("n", 4) + rpad("성공률", 9) + rpad("평균시도", 10) + rpad("평균초", 9) + rpad("평균USD", 11));
  console.log("─".repeat(84));
  for (const [cfg, rs] of [...byConfig].sort()) {
    const n = rs.length;
    const ok = rs.filter((r) => r.outcome === "merged").length;
    const avg = (f: (r: RunSummary) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
    console.log(
      pad(cfg, 20) + rpad(n, 4) + rpad(((ok / n) * 100).toFixed(0) + "%", 9) +
      rpad(avg((r) => r.attempts).toFixed(1), 10) +
      rpad((avg((r) => r.durationMs) / 1000).toFixed(0), 9) +
      rpad(avg((r) => r.costUsd).toFixed(4), 11),
    );
  }

  if (rows.some((r) => r.hasEstimated)) {
    console.log("\n* 비용에 추정치 포함 (Codex). src/pricing.ts 의 RATES 를 채우기 전까지 0 으로 계산됩니다.");
  }
  console.log();
}
