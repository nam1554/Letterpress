// Shared in-process liveness state, split out so store.ts can check runner
// liveness without a store↔runner import cycle. globalThis-backed to survive
// Next dev HMR module reloads.
const g = globalThis as unknown as { __mhmControllers?: Map<string, AbortController> };

/** AbortControllers of jobs currently executing in this process. */
export const liveControllers: Map<string, AbortController> = (g.__mhmControllers ??= new Map());
