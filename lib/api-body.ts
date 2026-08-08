import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * 첫 번째 검증 이슈를 사용자에게 보일 한 줄로.
 *
 * 이 앱의 사용자 대면 문구는 전부 한국어다(비개발자 팀원이 읽는다는 원칙).
 * 스키마가 문구를 달아 둔 이슈는 그대로 쓰고, **zod 기본 메시지는 한국어로
 * 덮는다** — 판별은 한글 포함 여부로 한다. 스키마 문구는 반드시 한글을 담고
 * zod 기본은 영어뿐이라, 코드·문면 패턴을 열거하는 것보다 견고하다.
 *
 * 실측(2026-08-08)으로 확인된 두 누출 경로:
 * - 최상위 타입 위반(`null`/`[]` 바디) → path 없음 + "Invalid input: expected
 *   object, received null".
 * - 문구 없는 필드(`provider: z.string().optional()`)에 잘못된 타입 →
 *   "provider: Invalid input: expected string, received number".
 * 필드명은 살려 둔다 — 어디가 문제인지가 사라지면 안내가 쓸모없어진다.
 * 최상위 문구에 "JSON 객체여야 합니다"를 넣지 않는 이유: artifact 라우트의
 * `z.union`은 **정상 객체**가 두 갈래를 모두 어겨도 path 없는 이슈를 내므로
 * (실측: `invalid_union`), 그렇게 쓰면 이미 객체를 보낸 사용자에게 객체를
 * 보내라고 잘못 안내하게 된다.
 */
function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "요청 형식이 올바르지 않습니다.";
  const path = issue.path.join(".");
  const fromSchema = /[가-힣]/.test(issue.message);
  if (fromSchema) return path ? `${path}: ${issue.message}` : issue.message;
  return path ? `${path}: 값 형식이 올바르지 않습니다.` : "요청 형식이 올바르지 않습니다.";
}

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
    return { ok: false, res: NextResponse.json({ error: issueMessage(parsed.error) }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}
