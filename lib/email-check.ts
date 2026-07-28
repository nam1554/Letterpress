/**
 * 발송 전 정적 검사 — 실무 체크리스트(발송 준비 README)의 자동화 가능한
 * 항목들. 렌더링 없이 HTML 텍스트만으로 판단한다.
 */
export type CheckLevel = "ok" | "warn" | "fail";

export interface EmailCheck {
  name: string;
  level: CheckLevel;
  detail: string;
}

const GMAIL_CLIP_BYTES = 102 * 1024;

export function checkEmailHtml(html: string): EmailCheck[] {
  const checks: EmailCheck[] = [];
  const bytes = Buffer.byteLength(html, "utf8");

  checks.push(
    bytes > GMAIL_CLIP_BYTES
      ? {
          name: "본문 용량",
          level: "warn",
          detail: `${(bytes / 1024).toFixed(0)}KB — Gmail은 102KB를 넘으면 본문을 잘라냅니다. 이미지를 base64 내장 대신 CDN 호스팅으로 빼세요.`,
        }
      : { name: "본문 용량", level: "ok", detail: `${(bytes / 1024).toFixed(0)}KB (Gmail 102KB 클리핑 안전)` },
  );

  checks.push(
    /<script[\s>]/i.test(html)
      ? { name: "스크립트", level: "fail", detail: "<script> 태그 발견 — 이메일 클라이언트가 차단하며 스팸 점수에 불리합니다." }
      : { name: "스크립트", level: "ok", detail: "없음" },
  );

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((tag) => !/\balt\s*=/i.test(tag)).length;
  checks.push(
    noAlt > 0
      ? { name: "이미지 alt", level: "warn", detail: `${imgs.length}개 중 ${noAlt}개에 alt가 없습니다 — 이미지 차단 시 내용이 사라집니다.` }
      : { name: "이미지 alt", level: "ok", detail: `이미지 ${imgs.length}개 모두 alt 있음` },
  );

  checks.push(
    /background(-image)?\s*:\s*url\(/i.test(html) || /\bbackground=["']/i.test(html)
      ? { name: "배경 이미지", level: "warn", detail: "CSS/속성 배경 이미지 발견 — Outlook 데스크톱에서 표시되지 않습니다." }
      : { name: "배경 이미지", level: "ok", detail: "없음 (Outlook 안전)" },
  );

  const insecure = [...html.matchAll(/(?:href|src)=["']http:\/\/[^"']+/gi)].length;
  checks.push(
    insecure > 0
      ? { name: "비보안 링크", level: "warn", detail: `http:// 링크/이미지 ${insecure}건 — https로 바꾸세요 (스팸 점수·혼합 콘텐츠).` }
      : { name: "비보안 링크", level: "ok", detail: "모두 https" },
  );

  const hasPreheader =
    /display\s*:\s*none[^>]*>/i.test(html) || /preheader/i.test(html);
  checks.push(
    hasPreheader
      ? { name: "프리헤더", level: "ok", detail: "숨김 프리헤더 영역이 있습니다." }
      : { name: "프리헤더", level: "warn", detail: "숨김 프리헤더가 없습니다 — 받은편지함 미리보기 문구를 제어할 수 없습니다." },
  );

  const relativeImgs = [...html.matchAll(/src=["']images\//g)].length;
  checks.push(
    relativeImgs > 0
      ? { name: "이미지 경로", level: "warn", detail: `상대경로 이미지 ${relativeImgs}건 — 발송 전 CDN 교체본을 만들거나 base64 내장본을 쓰세요.` }
      : { name: "이미지 경로", level: "ok", detail: "상대경로 이미지 없음 (호스팅/내장 완료)" },
  );

  return checks;
}
