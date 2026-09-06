import type { NodeFn } from "./index.js";

/**
 * 결정적 노드 — 브랜치를 푸시하고 PR 을 엽니다.
 * 외부에 나가는 유일한 지점이라 모델에게 맡기지 않습니다.
 */
export const integrator: NodeFn = async (ctx) => {
  const { branch, task } = ctx.state;

  const push = await ctx.sh(`git push -u origin ${branch}`);
  if (!push.ok) {
    ctx.state.lastTestOutput = push.out;
    return "escalate";
  }

  const title = task.split("\n")[0]?.slice(0, 72) ?? branch;
  const pr = await ctx.sh(
    `gh pr create --head ${branch} --title ${JSON.stringify(title)} --body-file - <<'BODY'\n${task}\nBODY`,
  );
  if (!pr.ok) {
    ctx.state.lastTestOutput = pr.out;
    return "escalate";
  }
  return "done";
};
