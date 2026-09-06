import type { NodeFn } from "./index.js";

const VERDICT = /^\s*VERDICT:\s*(APPROVE|REQUEST_CHANGES)\s*$/im;

export const reviewer: NodeFn = async (ctx) => {
  const { task, config, attempt } = ctx.state;

  const diff = await ctx.sh("git diff origin/HEAD...HEAD 2>/dev/null || git diff HEAD~1");

  const r = await ctx.agent("reviewer", {
    access: "read-only", // 리뷰어는 절대 코드를 못 고칩니다 — 권한으로 강제
    prompt: [
      "너는 리뷰어다. 아래 변경이 요구사항을 충족하는지, 결함이 없는지 검토해라.",
      "코드를 수정하지 마라. 저장소를 읽어 맥락을 확인하는 것은 괜찮다.",
      "",
      "## 요구사항",
      task,
      "",
      "## 변경분",
      "```diff",
      diff.out.slice(0, 20000),
      "```",
      "",
      "## 출력 형식",
      "지적사항을 심각한 것부터 나열하고, 마지막 줄에 정확히 다음 중 하나만 써라:",
      "VERDICT: APPROVE",
      "VERDICT: REQUEST_CHANGES",
    ].join("\n"),
  });

  if (!r.ok) return "escalate";

  // 판정이 파싱되지 않으면 통과가 아니라 재작업으로 봅니다 (fail-safe).
  const approved = VERDICT.exec(r.text)?.[1]?.toUpperCase() === "APPROVE";
  ctx.state.reviews.push({ attempt, approved, text: r.text });

  if (approved) return "integrator";
  if (attempt + 1 >= config.maxAttempts) return "escalate";
  ctx.state.attempt++;
  return "coder";
};
