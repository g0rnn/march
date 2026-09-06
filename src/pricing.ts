import type { ModelSpend, TokenUsage } from "./types.js";

/**
 * Codex 는 `--json` 이벤트로 토큰 수만 주고 비용을 주지 않습니다.
 * (Claude Agent SDK 는 modelUsage[].costUSD 로 비용을 직접 보고합니다.)
 *
 * 두 모델의 비용을 나란히 비교하려면 여기서 환산해야 합니다.
 * ⚠️ 단가는 의도적으로 비워뒀습니다 — 추측한 숫자를 넣으면
 *    비교 리포트 전체가 조용히 틀립니다. 공식 가격표를 보고 채우세요.
 *    채우기 전까지 costUsd 는 0 이고 costBasis 는 "estimated" 로 남습니다.
 */
export interface Rate {
  /** USD per 1M tokens */
  input: number;
  output: number;
  cacheRead: number;
}

export const RATES: Record<string, Rate> = {
  // "gpt-5-codex": { input: 0, output: 0, cacheRead: 0 },
};

const warned = new Set<string>();

export function estimateCost(model: string, u: TokenUsage): number {
  const r = RATES[model];
  if (!r) {
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(
        `[pricing] '${model}' 단가 미등록 → 비용 0 으로 기록. src/pricing.ts 의 RATES 를 채우세요.`,
      );
    }
    return 0;
  }
  const M = 1_000_000;
  const fresh = Math.max(0, u.inputTokens - u.cacheReadInputTokens);
  return (
    (fresh * r.input) / M +
    (u.cacheReadInputTokens * r.cacheRead) / M +
    (u.outputTokens * r.output) / M
  );
}

export function estimatedSpend(model: string, usage: TokenUsage): ModelSpend {
  return { model, usage, costUsd: estimateCost(model, usage), costBasis: "estimated" };
}

export function totalCost(spend: readonly ModelSpend[]): number {
  return spend.reduce((a, s) => a + s.costUsd, 0);
}
