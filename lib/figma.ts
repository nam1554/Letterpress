export interface FigmaRef {
  url: string;
  fileKey: string;
  nodeId?: string;
  /** 사람이 읽을 파일명 (URL 슬러그, e.g. "AISURFER_상품소개서-eDM"). */
  title?: string;
}

/**
 * Accepts figma.com /design/ /file/ /proto/ URLs and extracts fileKey + node-id.
 * Returns null for anything that is not a Figma file URL.
 */
export function parseFigmaUrl(input: string): FigmaRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null;

  const match = url.pathname.match(/^\/(design|file|proto)\/([A-Za-z0-9]+)(?:\/([^/]*))?/);
  if (!match) return null;

  const nodeIdRaw = url.searchParams.get("node-id") ?? undefined;
  // Figma uses "2343-115" in URLs for node "2343:115"
  const nodeId = nodeIdRaw?.replace(/-/g, ":");

  let title: string | undefined;
  try {
    title = match[3] ? decodeURIComponent(match[3]).replace(/-/g, " ").trim() : undefined;
  } catch {
    title = match[3];
  }
  if (!title) title = undefined;

  return { url: url.toString(), fileKey: match[2], nodeId, title };
}

/**
 * Rebuild the URL from the extracted fileKey/nodeId only. The result is what
 * gets interpolated into agent prompts — arbitrary user-typed URL contents
 * (file name slug, extra query params) never reach the prompt.
 */
export function canonicalFigmaUrl(ref: FigmaRef): string {
  const node = ref.nodeId ? `?node-id=${ref.nodeId.replace(/:/g, "-")}` : "";
  return `https://www.figma.com/design/${ref.fileKey}/${node}`;
}
