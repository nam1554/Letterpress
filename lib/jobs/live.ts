// Shared in-process liveness state, split out so store.ts can check runner
// liveness without a store↔runner import cycle. globalThis-backed to survive
// Next dev HMR module reloads.
const g = globalThis as unknown as {
  __mhmControllers?: Map<string, AbortController>;
  __mhmExitHook?: boolean;
};

/** AbortControllers of jobs currently executing in this process. */
export const liveControllers: Map<string, AbortController> = (g.__mhmControllers ??= new Map());

// 서버가 종료될 때 spawn된 CLI 에이전트를 함께 정리한다 — 안 하면 orphan이
// 남아 토큰을 계속 소모한다. 'exit'는 동기 훅이지만 abort→SIGTERM은 동기 syscall.
if (!g.__mhmExitHook) {
  g.__mhmExitHook = true;
  process.once("exit", () => {
    for (const controller of liveControllers.values()) controller.abort();
  });
}
