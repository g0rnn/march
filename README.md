# march

그래프 기반 AI 개발 조직. 제어 흐름은 **내 코드**가 정하고, 모델은 노드 안에서만 판단합니다.

```
planner ─▶ coder ─▶ tester ─┬─(pass)──▶ reviewer ─┬─(approve)─▶ integrator ─▶ done
             ▲              │                     │
             └──(fail)──────┘                     └─(changes)──┘
                    재시도 상한 초과 시 어느 쪽이든 ─▶ escalate
```

## 설계 원칙 네 가지

**1. 결정성은 두 층으로 나뉩니다.**

| 층 | 누가 정하나 | 강제 수단 |
|---|---|---|
| 그래프 — 다음에 누가 일하나 | 내 코드 (`src/runner.ts` 의 while 루프) | `if` / `while` |
| 노드 내부 — 어떤 툴을 어떤 순서로 | 모델 | `access` 권한 경계, 타임아웃 |

Agent SDK 의 `agents={}` 서브에이전트 위임은 **쓰지 않습니다.** 역할마다 최상위 호출을
따로 두고 순서를 코드가 정해야 "리뷰 없이 병합" 같은 경로가 원천 봉쇄됩니다.

**2. 판정은 모델이 아니라 종료 코드로.**

`tester` 와 `integrator` 는 LLM 을 부르지 않는 결정적 노드입니다. 테스트 통과 여부를
모델에게 물으면 "통과했다고 우기는" 실패 모드가 생깁니다. `reviewer` 는 모델이지만
`access: "read-only"` 로 묶여 자기가 리뷰하는 코드를 고칠 수 없습니다.

**3. 상태는 덮어쓰지 않고 쌓습니다.**

```
runs/<runId>/events.jsonl   append-only. 지표·대시보드의 원천 (불변)
runs/<runId>/state.json     재개용 최신 스냅샷 (events 에서 파생)
```

스냅샷만 남기면 "3번째 시도에서 왜 실패했나" 가 사라져 사후 비교가 불가능해집니다.

**4. 그래프는 파라미터, 실행은 실험.**

`RunConfig.assignment` 가 노드별 모델 배정을 담고 이벤트에 박힙니다.
같은 태스크를 배정만 바꿔 돌리면 `report` 가 설정별로 묶어 비교합니다.

## 자원 예산 (실측)

```
claude 프로세스 1개 RSS ≈ 450 MB   (컨텍스트가 쌓이면 증가)
```

어댑터는 스레드가 아니라 **OS 프로세스**를 띄웁니다. 오케스트레이터 자신은 I/O 만 하므로
가볍지만, 병렬 fan-out 은 즉시 메모리에 부딪힙니다. `maxConcurrent` 세마포어가
동시 실행을 제한합니다 — 16GB 머신 기준 **2~3** 권장.

프로세스라서 얻는 것: 에이전트가 죽어도 오케스트레이터는 살아있고, 타임아웃으로 kill 할 수
있고, 메모리 누수가 프로세스 종료로 회수됩니다.

## 사용법

```bash
npm run smoke                       # 모델 호출 없이 그래프 전이만 검증
npm run typecheck

npm run dev -- run --workdir ../대상레포 --task issue.md
npm run dev -- run --workdir ../대상레포 --task issue.md \
  --config-id coder-codex --coder codex     # A/B: 코더만 바꿔 재실행
npm run dev -- report                       # 설정별 성공률·시도·비용 비교
```

## 두 어댑터의 비대칭

| | Claude | Codex |
|---|---|---|
| 경로 | Agent SDK (`query()`) | `codex exec` 서브프로세스 |
| 최종 응답 | `SDKResultSuccess.result` | `-o <file>` (JSONL 파싱 아님) |
| 세션 | `resume: session_id` | `codex exec resume <thread_id>` |
| 비용 | `modelUsage[].costUSD` 를 **직접 보고** | 토큰만 제공 → 단가표 환산 필요 |

⚠️ **`src/pricing.ts` 의 `RATES` 가 비어 있습니다.** 채우기 전까지 Codex 실행의
비용은 0 으로 기록되고 `costBasis: "estimated"` 로 표시됩니다. 추측 단가를 넣으면
비교 리포트 전체가 조용히 틀리므로 의도적으로 비워뒀습니다.

토큰/비용 회계에는 `usage` 가 아니라 `modelUsage` 를 씁니다 — `usage` 는 메인 루프만
세고 서브에이전트 호출을 누락합니다 (SDK 타입 주석에 명시).

## 구조

```
src/
  types.ts          그래프·이벤트·비용의 단일 진실 원천 (대시보드와 공유할 타입)
  runner.ts         while 루프. 제어 흐름 전부가 여기 있습니다
  graph.ts          노드 이름 → 함수 등록부
  nodes/            planner·coder·reviewer(에이전트) / tester·integrator(결정적)
  adapters/         claude(SDK) · codex(서브프로세스) → 같은 AgentResult 로 정규화
  events.ts         append-only 이벤트 로그
  limits.ts         동시 실행 세마포어
  pricing.ts        Codex 토큰 → USD 환산
  report.ts         설정별 집계 비교
  smoke.ts          가짜 어댑터로 전이 검증
```

## 다음 단계

1. `src/pricing.ts` 단가 채우기 — 안 하면 비용 비교가 반쪽입니다
2. 실제 레포에 첫 `run` — 프롬프트는 여기서부터 고쳐나갑니다
3. 웹 대시보드 (Next.js) — `types.ts` 의 `RunEvent` 를 그대로 import 해서 씁니다
4. 병렬 fan-out (코더 여러 명 → 최선 선택) — 세마포어가 이미 준비되어 있습니다
