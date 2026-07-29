export type RequestResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * 변경 요청 공용 헬퍼 — 절대 throw 하지 않는다.
 *
 * 호출부가 `(await res.json()).error`로 에러를 읽으면, 서버가 JSON이 아닌
 * 응답(라우트에서 처리되지 않은 예외 → 500 에러 페이지)을 주거나 아예 닿지
 * 않을 때 그 자리에서 예외가 나 클릭이 아무 반응 없이 삼켜진다. 사용자에게는
 * 버튼이 고장 난 것처럼 보인다.
 */
export async function requestJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<RequestResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: "서버에 연결할 수 없습니다. 앱이 실행 중인지 확인해 주세요." };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null; // 본문이 없거나 JSON이 아님 (에러 페이지 등)
  }

  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    return {
      ok: false,
      error:
        typeof message === "string" && message.length > 0
          ? message
          : `요청이 실패했습니다 (HTTP ${res.status}).`,
    };
  }
  return { ok: true, data: body as T };
}

/** JSON 바디를 실어 보내는 요청. */
export function sendJson<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<RequestResult<T>> {
  return requestJson<T>(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
