import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * API 라우트 요청 바디 파싱 + zod 검증 공통 헬퍼.
 * 실패 시 첫 번째 이슈 메시지를 400 응답으로 만들어 돌려준다 —
 * 라우트는 `if (!r.ok) return r.res;` 한 줄로 처리한다.
 */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      res: NextResponse.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    const msg = issue ? `${path ? `${path}: ` : ""}${issue.message}` : "요청 형식이 올바르지 않습니다.";
    return { ok: false, res: NextResponse.json({ error: msg }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}
