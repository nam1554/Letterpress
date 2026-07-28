export interface FigmaRef {
  url: string;
  fileKey: string;
  nodeId?: string;
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

  const match = url.pathname.match(/^\/(design|file|proto)\/([A-Za-z0-9]+)(\/|$)/);
  if (!match) return null;

  const nodeIdRaw = url.searchParams.get("node-id") ?? undefined;
  // Figma uses "2343-115" in URLs for node "2343:115"
  const nodeId = nodeIdRaw?.replace(/-/g, ":");

  return { url: url.toString(), fileKey: match[2], nodeId };
}
