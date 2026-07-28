import path from "node:path";

/**
 * CDN 교체본 생성: HTML 안의 상대경로 이미지(src="images/…")를 URL 템플릿으로
 * 치환한다. 실무 플로우(images/를 CDN에 올리고 src를 일괄 교체)의 자동화.
 *
 * 템플릿 플레이스홀더:
 *   {file} — 파일명 전체 (hero.jpg)
 *   {name} — 확장자 제외 (hero)
 *   {ext}  — 확장자만 (jpg)
 *
 * 예) IIIF: https://cdn.example.com/iiif/3/edm__{name}/full/max/0/default.{ext}
 * 예) 정적: https://cdn.example.com/assets/{file}
 */
export function renderCdnUrl(template: string, file: string): string {
  const ext = path.extname(file).replace(/^\./, "");
  const name = file.slice(0, file.length - (ext ? ext.length + 1 : 0));
  return template
    .replaceAll("{file}", file)
    .replaceAll("{name}", name)
    .replaceAll("{ext}", ext);
}

export interface HostingResult {
  html: string;
  replaced: number;
  /** 치환된 이미지 파일명 목록 (중복 제거). */
  files: string[];
}

export function applyCdnTemplate(html: string, template: string): HostingResult {
  const files = new Set<string>();
  let replaced = 0;
  const result = html.replace(
    // 대소문자·공백 관용: src="…", SRC = '…' 모두 허용
    /(src\s*=\s*["'])images\/([^"']+)(["'])/gi,
    (_m, pre: string, file: string, post: string) => {
      files.add(file);
      replaced += 1;
      return `${pre}${renderCdnUrl(template, file)}${post}`;
    },
  );
  return { html: result, replaced, files: [...files].sort() };
}

/** 템플릿이 그럴듯한 https URL 형태인지 가벼운 검증. */
export function isValidCdnTemplate(template: string): boolean {
  if (!/^https:\/\//.test(template)) return false;
  try {
    new URL(renderCdnUrl(template, "probe.png"));
    return true;
  } catch {
    return false;
  }
}
