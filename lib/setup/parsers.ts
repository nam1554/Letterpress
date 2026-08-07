// ---------------------------------------------------------------------------
// Figma MCP 연결 상태 파서 — 각 CLI의 `mcp list` 출력에서 figma 항목을 찾는다.
// 실측 출력(2026-07-29) 기반. 순수 함수로 분리해 유닛 테스트한다.
// ---------------------------------------------------------------------------

export type McpStatus = "connected" | "registered" | "missing";

export const findFigmaLine = (out: string): string | undefined =>
  out.split("\n").find((l) => /figma/i.test(l));

/** `claude mcp list`: "claude.ai Figma: https://mcp.figma.com/mcp - ✔ Connected" */
export function figmaMcpFromClaudeList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  return /[✔✓]/.test(line) ? "connected" : "registered";
}

/** `codex mcp list`: 테이블 행 "figma  https://mcp.figma.com/mcp  -  enabled  OAuth" */
export function figmaMcpFromCodexList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  return /\benabled\b/i.test(line) ? "connected" : "registered";
}
