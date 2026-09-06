import type { NodeFn } from "./index.js";

export const planner: NodeFn = async (ctx) => {
  const { task } = ctx.state;

  const r = await ctx.agent("planner", {
    access: "read-only", // 계획 단계는 파일을 못 건드립니다
    prompt: [
      "너는 이 저장소의 설계자다. 아래 요구사항을 구현하기 위한 계획을 세워라.",
      "코드를 수정하지 말고, 저장소를 읽어 파악한 뒤 계획만 작성한다.",
      "",
      "## 요구사항",
      task,
      "",
      "## 출력 형식",
      "- 수정할 파일 목록과 각 파일에서 할 일",
      "- 새로 만들 파일이 있다면 그 경로와 역할",
      "- 검증 방법 (어떤 테스트가 이 변경을 커버하는가)",
      "간결하게. 코드 블록은 꼭 필요할 때만.",
    ].join("\n"),
  });

  if (!r.ok) return "escalate";
  ctx.state.plan = r.text;
  return "coder";
};
