import { logProblem } from "./log";

/**
 * Node 런타임 전용 오류 수집 — instrumentation.ts가 런타임을 확인한 뒤에만
 * 불러온다(Edge 번들에는 fs가 없다).
 */
// Next dev의 HMR은 모듈을 다시 평가할 수 있고, register()도 여러 번 불릴 수
// 있다. 그때마다 핸들러가 쌓이면 오류 하나가 진단 로그에 여러 번 적혀 담당자가
// 반복 발생으로 오해하고, Node는 리스너 11개부터 경고를 띄운다.
// (`lib/jobs/live.ts`가 종료 훅에 같은 가드를 두는 것과 같은 이유다.)
const g = globalThis as unknown as { __mhmProblemLogHooked?: boolean };

export function registerNodeProblemLog(): void {
  if (g.__mhmProblemLogHooked) return;
  g.__mhmProblemLogHooked = true;

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
