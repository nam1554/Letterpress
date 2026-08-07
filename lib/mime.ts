import path from "node:path";

/**
 * 산출물 서빙(다운로드·미리보기)이 공유하는 MIME 맵 — 두 라우트가 각자 맵을
 * 들고 있다가 이미 드리프트가 났었다(미리보기에만 .svg가 있어 다운로드는
 * octet-stream으로 응답). 파일 확장자 기반이면 여기만 고친다.
 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

/** 파일 경로의 확장자로 Content-Type을 정한다. 모르는 확장자는 octet-stream. */
export function contentTypeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
