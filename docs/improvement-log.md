# 개선 루프 기록

설계: `docs/superpowers/specs/2026-07-29-stability-improvement-loop-design.md`

베이스라인 (`5aee73a`): vitest 57 pass / 3 skip · tsc 0 · lint 0.

## 백로그

| 순위 | 축 | 상태 |
|---|---|---|
| 1 | 런타임 견고성 (`runner.ts`, `store.ts`) | ✅ R1 |
| 2 | 스트림 (SSE `events`) | 대기 — R1에서 미보호 지점 발견, 순위 상향 |
| 3 | 품질 게이트 (`acceptance.ts` + 자동 보수 경로) | 대기 |
| 4 | API 경계 (라우트 13개) | 대기 |
| 5 | UX 완성도 | 대기 |
| 6 | E2E (mock 프로바이더) | 대기 |

### 관찰됐지만 고치지 않은 것

- `store.ts` `live.reconciling`에 추가된 id가 제거되지 않는다. 같은 프로세스
  안에서 잡이 다시 stale이 되는 경로가 실제로는 없어 보여 보류. (낮음)
- 잡 id는 `randomUUID().slice(0, 8)` — 수만 건 규모에서만 충돌 위험. (낮음)

## 라운드 기록

### R1 — 런타임 견고성 (`c04614b`..)

발견 4건, 전부 수정. 테스트 +5 (57 → 62 pass).

| # | 결함 | 증상 | 수정 |
|---|---|---|---|
| 1 | `live.ts` — 신호 종료 시 정리 안 됨 | CLI는 `detached`라 포그라운드 그룹 SIGINT를 못 받고, SIGINT/SIGTERM은 `'exit'`을 발생시키지 않는다 → Ctrl-C 후 에이전트가 고아로 남아 토큰 소모 | `abortAllForShutdown()` 추출 + SIGINT/SIGTERM 훅. 다른 핸들러가 있으면 종료는 그쪽에 위임 |
| 2 | `store.ts` `readEvents` | 크래시로 마지막 줄이 잘리면 `catch`가 **전체 로그**를 버려 UI·SSE 리플레이가 통째로 빔 | 줄 단위 파싱 — 깨진 줄만 건너뜀 |
| 3 | `store.ts` `appendEvent` | 디스크 오류나 구독자(닫힌 SSE) 예외가 러너로 전파돼 실행 중인 잡을 죽임 | 쓰기·통지 모두 최선 노력. 구독자 집합은 복사본을 순회 |
| 4 | `runner.ts` `startJob` | 준비 단계 throw 시 컨트롤러·타이머 누수 → `runningJobCount()`가 영구히 부풀어 **이후 모든 작업이 429로 거부**되고 해당 잡은 삭제도 불가 | 준비 구간을 가드하고 실패 시 전역 상태 롤백 후 rethrow |
