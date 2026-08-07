/**
 * Next dev의 HMR 모듈 리로드에서 살아남아야 하는 프로세스 전역 상태.
 * 모듈 스코프 변수는 리로드마다 새로 만들어져 실행 중 잡의 컨트롤러·큐가
 * 유실되므로 globalThis에 키로 보관한다.
 *
 * **제자리에서 변이하는 컨테이너(Map·객체) 전용.** 재할당으로 갱신하는
 * 캐시(health/setup의 `{at, …}` 스냅샷)는 키 재대입이 필요해 이 헬퍼가
 * 맞지 않고, 값의 모양이 바뀐 적 있는 키(live.ts의 exit hook 플래그처럼
 * 마이그레이션 검사가 붙는 곳)는 원시 접근을 유지한다 — 이전 세션의 옛
 * 모양 값을 `??=`가 그대로 돌려주기 때문이다.
 */
export function hmrGlobal<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T | undefined>;
  return (g[key] ??= init());
}
