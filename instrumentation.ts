import type { Instrumentation } from "next";

/**
 * 서버에서 터진 문제를 파일로 남긴다 — 진단 번들(⬇ 문제 신고용 파일)의 재료다.
 * `onRequestError`는 Next가 서버 오류를 잡았을 때 부르는 공식 훅이다.
 *
 * 파일에 쓰는 구현은 Node 런타임에서만 불러온다. `process.env.NEXT_RUNTIME`은
 * 번들 시점에 상수로 치환되므로, Edge 번들에서는 아래 import가 죽은 코드가 되어
 * 사라진다 — 그러지 않으면 fs·process.cwd를 쓴다는 경고가 6건 뜬다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNodeProblemLog } = await import("./lib/diagnostics/instrument-node");
  registerNodeProblemLog();
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    // Edge 번들에는 fs가 없어 파일로 남길 수 없다. 그래도 조용히 삼키지는
    // 않는다 — 여기서 그냥 return하면 edge 런타임으로 선언된 라우트의 오류만
    // 아무 흔적 없이 사라진다(계측을 붙이기 전 상태로 되돌아간다).
    console.error(
      `[request-error] ${context.routeType} ${request.method} ${request.path}`,
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    return;
  }
  const { logRequestError } = await import("./lib/diagnostics/instrument-node");
  logRequestError(err, request, context);
};
