// ---------------------------------------------------------------------------
// 키 저장 시 즉시 검증 — 오타를 잡 실패가 아니라 저장 시점에 잡는다.
// ---------------------------------------------------------------------------

export type KeyCheck = "ok" | "invalid" | "network";

export async function validateFigmaToken(token: string): Promise<KeyCheck> {
  try {
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-FIGMA-TOKEN": token },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "invalid" : "network";
  } catch {
    return "network";
  }
}
