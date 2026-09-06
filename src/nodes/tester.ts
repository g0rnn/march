import type { NodeFn } from "./index.js";

/**
 * 결정적 노드 — LLM 을 부르지 않습니다.
 * 통과 여부를 모델 판단이 아니라 종료 코드로 정하는 게 핵심입니다.
 * 여기가 모델이면 "테스트가 통과했다고 우기는" 실패 모드가 생깁니다.
 */
export const tester: NodeFn = async (ctx) => {
  const { config, attempt } = ctx.state;
  const res = await ctx.sh(config.testCommand);

  ctx.state.testPassed = res.ok;
  ctx.state.lastTestOutput = res.out;

  if (res.ok) return "reviewer";
  if (attempt + 1 >= config.maxAttempts) return "escalate";
  ctx.state.attempt++;
  return "coder";
};
