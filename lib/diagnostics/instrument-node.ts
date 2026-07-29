import { logProblem } from "./log";

/**
 * Node 런타임 전용 오류 수집 — instrumentation.ts가 런타임을 확인한 뒤에만
 * 불러온다(Edge 번들에는 fs가 없다).
 */
export function registerNodeProblemLog(): void {
  // 이 두 가지가 지금까지 터미널에만 찍히고 사라지던 것들이다.
  process.on("unhandledRejection", (reason) => {
    logProblem({
      source: "unhandled-rejection",
      message: reason instanceof Error ? reason.message : String(reason),
      detail: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on("uncaughtException", (error) => {
    logProblem({ source: "uncaught-exception", message: error.message, detail: error.stack });
  });
}

export function logRequestError(
  err: unknown,
  request: { method: string; path: string },
  context: { routeType: string },
): void {
  logProblem({
    source: `${context.routeType} ${request.method} ${request.path}`,
    message: err instanceof Error ? err.message : String(err),
    detail: err instanceof Error ? err.stack : undefined,
  });
}
