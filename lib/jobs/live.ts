// Shared in-process liveness state, split out so store.ts can check runner
// liveness without a store↔runner import cycle. globalThis-backed to survive
// Next dev HMR module reloads.
const g = globalThis as unknown as {
  __mhmControllers?: Map<string, AbortController>;
  __mhmExitHook?: boolean;
};

/** AbortControllers of jobs currently executing in this process. */
export const liveControllers: Map<string, AbortController> = (g.__mhmControllers ??= new Map());

/**
 * 실행 중인 모든 잡을 중단한다 — abort는 jsonl-cli의 killGroup을 동기로 호출해
 * CLI 프로세스 그룹에 SIGTERM을 보낸다.
 */
export function abortAllForShutdown(): void {
  for (const controller of liveControllers.values()) controller.abort();
  liveControllers.clear();
}

// 서버가 종료될 때 spawn된 CLI 에이전트를 함께 정리한다 — 안 하면 orphan이
// 남아 토큰을 계속 소모한다. 'exit'는 동기 훅이지만 abort→SIGTERM은 동기 syscall.
if (!g.__mhmExitHook) {
  g.__mhmExitHook = true;
  process.once("exit", abortAllForShutdown);

  // 'exit'만으로는 부족하다: Ctrl-C(SIGINT)/SIGTERM으로 죽는 프로세스는 'exit'를
  // 발생시키지 않고, CLI는 detached(자체 프로세스 그룹)라 포그라운드 그룹으로
  // 가는 SIGINT도 받지 못한다 — 둘이 겹치면 고아 에이전트가 그대로 남는다.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      abortAllForShutdown();
      // 다른 핸들러(Next의 graceful shutdown 등)가 있으면 종료는 그쪽에 맡긴다.
      if (process.listenerCount(signal) === 1) process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}
