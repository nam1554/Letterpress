import type { Instrumentation } from "next";

/**
 * 서버에서 터진 문제를 파일로 남긴다 — 진단 번들(⬇ 문제 신고용 파일)의 재료다.
 * `onRequestError`는 Next가 서버 오류를 잡았을 때 부르는 공식 훅이다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logProblem } = await import("./lib/diagnostics/log");

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

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logProblem } = await import("./lib/diagnostics/log");
  logProblem({
    source: `${context.routeType} ${request.method} ${request.path}`,
    message: err instanceof Error ? err.message : String(err),
    detail: err instanceof Error ? err.stack : undefined,
  });
};
