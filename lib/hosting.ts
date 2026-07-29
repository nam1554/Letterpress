import path from "node:path";

/**
 * CDN 교체본 생성: HTML 안의 상대경로 이미지(src="images/…")를 URL 템플릿으로
 * 치환한다. 실무 플로우(images/를 CDN에 올리고 src를 일괄 교체)의 자동화.
 *
 * 템플릿 플레이스홀더:
 *   {folder} — 교체본 생성 시 입력하는 캠페인 폴더명 (예: aisurfer_edm_20260729)
 *   {file}   — 파일명 전체 (hero.jpg)
 *   {name}   — 확장자 제외 (hero)
 *   {ext}    — 확장자만 (jpg)
 *
 * 예) IIIF: https://cdn.example.com/iiif/3/{folder}__{file}/full/max/0/default.{ext}
 * 예) 정적: https://cdn.example.com/assets/{folder}/{file}
 *
 * 템플릿은 설정에 저장돼 캠페인마다 재사용하고, {folder}만 매번 바꾼다 —
 * 지난 발송본의 이미지를 덮어쓰지 않기 위한 캠페인별 네임스페이스.
 */
export function renderCdnUrl(template: string, file: string, folder = ""): string {
  const ext = path.extname(file).replace(/^\./, "");
  const name = file.slice(0, file.length - (ext ? ext.length + 1 : 0));
  return template
    .replaceAll("{folder}", folder)
    .replaceAll("{file}", file)
    .replaceAll("{name}", name)
    .replaceAll("{ext}", ext);
}

/** 템플릿이 {folder}를 요구하는지. */
export function templateNeedsFolder(template: string): boolean {
  return template.includes("{folder}");
}

/**
 * 폴더명은 URL 경로 세그먼트에 그대로 들어간다 — 안전한 문자만 허용.
 * (사용자 CDN에서 `__`가 폴더 구분자라 언더스코어 연속도 허용)
 */
export function isValidCdnFolder(folder: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(folder);
}

export interface HostingResult {
  html: string;
  replaced: number;
  /** 치환된 이미지 파일명 목록 (중복 제거). */
  files: string[];
}

export function applyCdnTemplate(html: string, template: string, folder = ""): HostingResult {
  const files = new Set<string>();
  let replaced = 0;
  const swap = (file: string) => {
    files.add(file);
    replaced += 1;
    return renderCdnUrl(template, file, folder);
  };
  const result = html
    // 대소문자·공백 관용: src="…", SRC = '…' 모두 허용. background="images/…"
    // 속성도 같은 형태다 (Outlook용 폴백 속성).
    .replace(
      /((?:src|background)\s*=\s*["'])images\/([^"']+)(["'])/gi,
      (_m, pre: string, file: string, post: string) => `${pre}${swap(file)}${post}`,
    )
    // CSS 배경: url('images/…') / url("images/…") / url(images/…)
    .replace(
      /(url\(\s*['"]?)images\/([^'")]+)(['"]?\s*\))/gi,
      (_m, pre: string, file: string, post: string) => `${pre}${swap(file)}${post}`,
    );
  return { html: result, replaced, files: [...files].sort() };
}

/** 발송본 폰트 정책: 임베드 서브셋 대신 CDN 전체본 (Apple Mail 등은 웹폰트 적용,
 * Gmail/Outlook은 시스템 폰트 폴백 — 폴백 스택은 각 요소의 font-family에 이미 있다). */
const PRETENDARD_CDN_IMPORT =
  "@import url('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.min.css');";

export interface FontSwapResult {
  html: string;
  /** 제거한 base64 임베드 @font-face 개수 (0이면 원본 그대로). */
  removed: number;
}

/**
 * base64 임베드 @font-face를 제거하고 CDN @import로 대체한다.
 * Gmail은 본문 102KB를 넘으면 잘라내는데, 서브셋 폰트 임베드만 ~74KB라
 * CDN 교체본(발송용)은 폰트를 밖으로 빼야 안전 범위에 들어온다.
 */
export function swapEmbeddedFontsForCdn(html: string): FontSwapResult {
  let removed = 0;
  let out = html.replace(
    // @font-face 블록 안에 중첩 중괄호는 없으므로 [^}]*로 충분하다.
    /@font-face\s*\{[^}]*url\(\s*["']?data:[^}]*\}/gi,
    () => {
      removed += 1;
      return "";
    },
  );
  if (removed === 0) return { html, removed };
  if (/<style[^>]*>/i.test(out)) {
    out = out.replace(/<style[^>]*>/i, (m) => `${m}\n${PRETENDARD_CDN_IMPORT}`);
  } else if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `<style>${PRETENDARD_CDN_IMPORT}</style></head>`);
  } else {
    out = `<style>${PRETENDARD_CDN_IMPORT}</style>${out}`;
  }
  return { html: out, removed };
}

/** 템플릿이 그럴듯한 https URL 형태인지 가벼운 검증. */
export function isValidCdnTemplate(template: string): boolean {
  if (!/^https:\/\//.test(template)) return false;
  try {
    new URL(renderCdnUrl(template, "probe.png", "probe"));
    return true;
  } catch {
    return false;
  }
}
