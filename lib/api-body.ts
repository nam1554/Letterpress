import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * 크기 위반의 단위 — 배열은 "개", 문자열은 "자", 숫자는 단위 없음.
 * 어미("이상이어야"/"이하여야")는 단위가 아니라 이상·이하에 붙으므로 고정이다.
 */
function sizeUnit(origin: unknown): string {
  if (origin === "array") return "개";
  if (origin === "string") return "자";
  return "";
}

/**
 * zod 기본(영어) 이슈를 한국어로. **이유는 남긴다** — 전부 "값 형식이
 * 올바르지 않습니다"로 뭉개면 bulk-delete의 `ids`가 비었는지 200개를
 * 넘겼는지 구분할 수 없다(리뷰에서 잡힌 퇴행).
 */
function fallbackMessage(issue: z.core.$ZodIssue): string {
  // 경계 포함 여부를 반영한다 — `.gt(0)`은 `inclusive: false`라 "0 이상"이라고
  // 하면 방금 거부한 값을 허용한다고 말하는 셈이 된다.
  if (issue.code === "too_small") {
    const unit = sizeUnit(issue.origin);
    return issue.inclusive
      ? `최소 ${issue.minimum}${unit} 이상이어야 합니다.`
      : `${issue.minimum}${unit}보다 커야 합니다.`;
  }
  if (issue.code === "too_big") {
    const unit = sizeUnit(issue.origin);
    return issue.inclusive
      ? `최대 ${issue.maximum}${unit} 이하여야 합니다.`
      : `${issue.maximum}${unit}보다 작아야 합니다.`;
  }
  if (issue.code === "invalid_format") return "형식이 올바르지 않습니다.";
  return "값 형식이 올바르지 않습니다.";
}

/**
 * 첫 번째 검증 이슈를 사용자에게 보일 한 줄로.
 *
 * 이 앱의 사용자 대면 문구는 전부 한국어다(비개발자 팀원이 읽는다는 원칙).
 * 스키마가 문구를 달아 둔 이슈는 그대로 쓰고, **zod 기본 메시지는 한국어로
 * 덮는다** — 판별은 한글 포함 여부로 한다. 스키마 문구는 반드시 한글을 담고
 * zod 기본은 영어뿐이라, 코드·문면 패턴을 열거하는 것보다 견고하다.
 *
 * 실측(2026-08-08)으로 확인된 누출·오도 경로 넷, 전부 테스트로 고정했다:
 * - 최상위 타입 위반(`null`/`[]` 바디) → path 없음 + "Invalid input: expected
 *   object, received null".
 * - 문구 없는 필드(`provider: z.string().optional()`)에 잘못된 타입 →
 *   "provider: Invalid input: expected string, received number".
 * - 최상위 문구에 "JSON 객체여야 합니다"를 넣으면 안 된다: artifact 라우트의
 *   `z.union`은 **정상 객체**가 두 갈래를 모두 어겨도 path 없는 이슈를 내므로
 *   (실측: `invalid_union`), 이미 객체를 보낸 사용자에게 객체를 보내라고
 *   잘못 안내하게 된다.
 * - 스키마 문구가 이미 필드명을 담고 있으면 path 접두를 붙이지 않는다 —
 *   안 그러면 "figmaUrl: figmaUrl이 필요합니다."처럼 이름이 두 번 나온다.
 *   이 중복 검사는 **스키마 문구에만** 적용한다. 폴백 문구는 우리가 만든
 *   것이라 필드명을 담을 일이 없고, 거기까지 부분 문자열로 검사하면 숫자
 *   배열 인덱스("0")가 한계값("최소 10자")의 숫자와 맞아 경로가 통째로
 *   사라진다 — 어느 항목이 틀렸는지가 지워지는 셈이다(리뷰 실측).
 */
function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "요청 형식이 올바르지 않습니다.";
  const path = issue.path.join(".");
  const fromSchema = /[가-힣]/.test(issue.message);
  if (!fromSchema) {
    return path ? `${path}: ${fallbackMessage(issue)}` : "요청 형식이 올바르지 않습니다.";
  }
  if (!path) return issue.message;
  const field = String(issue.path.at(-1) ?? "");
  return field && issue.message.includes(field) ? issue.message : `${path}: ${issue.message}`;
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
