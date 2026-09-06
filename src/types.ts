/**
 * 그래프 층의 단일 진실 원천.
 * 러너와 (나중에 붙일) 대시보드가 이 파일을 공유합니다.
 */

// ─────────────────────────────────────────────────────────────
// 노드
// ─────────────────────────────────────────────────────────────

/** 에이전트가 수행하는 노드. 각각 모델 하나가 배정됩니다. */
export const AGENT_NODES = ["planner", "coder", "reviewer"] as const;
export type AgentNode = (typeof AGENT_NODES)[number];

/** LLM 없이 코드로만 도는 노드. 결정적이라 재현 가능합니다. */
export const DETERMINISTIC_NODES = ["tester", "integrator"] as const;
export type DeterministicNode = (typeof DETERMINISTIC_NODES)[number];

/** 종단 노드. 여기 도달하면 while 루프가 끝납니다. */
export const TERMINAL_NODES = ["done", "escalate"] as const;
export type TerminalNode = (typeof TERMINAL_NODES)[number];

export type NodeName = AgentNode | DeterministicNode | TerminalNode;

export function isTerminal(n: NodeName): n is TerminalNode {
  return (TERMINAL_NODES as readonly string[]).includes(n);
}

// ─────────────────────────────────────────────────────────────
// 어댑터 (모델 호출)
// ─────────────────────────────────────────────────────────────

export type AgentName = "claude" | "codex";

export interface AgentRequest {
  prompt: string;
  cwd: string;
  /** 노드별 권한 경계. 리뷰어는 읽기 전용으로 묶습니다. */
  access: "read-only" | "write";
  /** 이전 턴의 세션을 이어받아 컨텍스트를 유지합니다. */
  resume?: string;
  systemPrompt?: string;
  model?: string;
  timeoutMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Codex 의 reasoning_output_tokens. outputTokens 에 이미 포함될 수 있음. */
  reasoningOutputTokens?: number;
}

export interface ModelSpend {
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /**
   * reported  = 공급자가 비용을 직접 알려줌 (Claude Agent SDK 의 modelUsage.costUSD)
   * estimated = 토큰 수만 받아서 pricing.ts 단가표로 환산 (Codex)
   * 비교 리포트에서 이 둘을 섞어 보면 안 되므로 항상 같이 저장합니다.
   */
  costBasis: "reported" | "estimated";
}

export interface AgentResult {
  ok: boolean;
  /** 에이전트의 최종 응답 텍스트. */
  text: string;
  /** 다음 노드에서 resume 으로 이어붙일 수 있는 세션 식별자. */
  sessionId?: string;
  durationMs: number;
  numTurns?: number;
  spend: ModelSpend[];
  error?: string;
}

export interface Agent {
  readonly name: AgentName;
  run(req: AgentRequest): Promise<AgentResult>;
}

// ─────────────────────────────────────────────────────────────
// 실행 설정 — A/B 비교의 축
// ─────────────────────────────────────────────────────────────

export interface RunConfig {
  /** 비교 리포트에서 실행들을 묶는 라벨. 예: "coder-codex". */
  configId: string;
  /** 어느 노드에 어느 모델을 붙일지. 이걸 바꿔가며 비교합니다. */
  assignment: Record<AgentNode, AgentName>;
  /** 코더로 되돌아가는 최대 횟수. 무한루프 방지. */
  maxAttempts: number;
  /** 동시에 띄울 에이전트 프로세스 상한. 실측 기준 450MB/개. */
  maxConcurrent: number;
  /** 노드 하나의 벽시계 상한. 넘으면 프로세스를 kill 합니다. */
  nodeTimeoutMs: number;
  /** tester 노드가 실행할 명령. 종료 코드 0 이면 통과. */
  testCommand: string;
}

// ─────────────────────────────────────────────────────────────
// 실행 상태
// ─────────────────────────────────────────────────────────────

export interface ReviewRecord {
  attempt: number;
  approved: boolean;
  text: string;
}

export type RunOutcome = "merged" | "escalated" | "failed";

export interface RunState {
  runId: string;
  config: RunConfig;
  /** 이슈 본문. 이 실행의 입력. */
  task: string;
  /** 에이전트가 작업할 대상 레포 경로. 이 프로젝트 자신이 아닙니다. */
  workdir: string;
  branch: string;

  node: NodeName;
  attempt: number;

  plan?: string;
  lastTestOutput?: string;
  testPassed?: boolean;
  reviews: ReviewRecord[];

  /** 노드별 세션 id. 같은 역할을 다시 부를 때 컨텍스트를 이어받습니다. */
  sessions: Partial<Record<AgentNode, string>>;

  startedAt: string;
  totals: { costUsd: number; durationMs: number };
}

// ─────────────────────────────────────────────────────────────
// 이벤트 — append-only. 지표와 대시보드의 원천.
// ─────────────────────────────────────────────────────────────

interface EventBase {
  ts: string;
  runId: string;
}

export type RunEvent =
  | (EventBase & {
      t: "run_started";
      config: RunConfig;
      task: string;
      workdir: string;
      branch: string;
    })
  | (EventBase & {
      t: "node_started";
      node: NodeName;
      agent: AgentName | null; // 결정적 노드는 null
      attempt: number;
    })
  | (EventBase & {
      t: "node_finished";
      node: NodeName;
      agent: AgentName | null;
      attempt: number;
      ok: boolean;
      next: NodeName;
      durationMs: number;
      spend: ModelSpend[];
      error?: string;
    })
  | (EventBase & {
      t: "run_finished";
      outcome: RunOutcome;
      durationMs: number;
      costUsd: number;
      attempts: number;
    });
