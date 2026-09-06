import type { NodeFn } from "./index.js";

export const coder: NodeFn = async (ctx) => {
  const { plan, task, reviews, lastTestOutput, testPassed, attempt } = ctx.state;

  // 되돌아온 경우에만 피드백을 붙입니다. 첫 시도에는 계획만 넘깁니다.
  const feedback: string[] = [];
  if (testPassed === false && lastTestOutput) {
    feedback.push("## 직전 테스트 실패 출력", "```", lastTestOutput.slice(-4000), "```");
  }
  const lastReview = reviews.at(-1);
  if (lastReview && !lastReview.approved) {
    feedback.push("## 리뷰어 지적사항", lastReview.text);
  }

  const r = await ctx.agent("coder", {
    access: "write",
    prompt: [
      `너는 구현 담당이다. (시도 ${attempt + 1}회차)`,
      "계획에 따라 코드를 수정하고, 변경분을 커밋해라.",
      "커밋 메시지는 무엇을 왜 바꿨는지 한 줄로 쓴다.",
      "",
      "## 요구사항",
      task,
      "",
      "## 계획",
      plan ?? "(계획 없음 — 스스로 판단해라)",
      ...(feedback.length ? ["", ...feedback] : []),
    ].join("\n"),
  });

  if (!r.ok) return "escalate";
  return "tester";
};
