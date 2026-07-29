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
  const result = html.replace(
    // 대소문자·공백 관용: src="…", SRC = '…' 모두 허용
    /(src\s*=\s*["'])images\/([^"']+)(["'])/gi,
    (_m, pre: string, file: string, post: string) => {
      files.add(file);
      replaced += 1;
      return `${pre}${renderCdnUrl(template, file, folder)}${post}`;
    },
  );
  return { html: result, replaced, files: [...files].sort() };
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
