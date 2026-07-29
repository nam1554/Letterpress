import { describe, expect, it } from "vitest";
import {
  figmaMcpFromClaudeList,
  figmaMcpFromCodexList,
  figmaMcpFromGeminiList,
} from "./setup";

// 실측 출력 (2026-07-29, 각 CLI `mcp list`) 기반 — 포맷이 바뀌면 여기서 잡는다.

describe("figmaMcpFromClaudeList", () => {
  const connected = [
    "Checking MCP server health…",
    "",
    "claude.ai Figma: https://mcp.figma.com/mcp - ✔ Connected",
    "plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✔ Connected",
    "mantine: npx -y @mantine/mcp-server - ⏸ Pending approval (run `claude` to approve)",
  ].join("\n");

  it("detects a connected figma connector", () => {
    expect(figmaMcpFromClaudeList(connected)).toBe("connected");
  });

  it("treats a failing figma line as registered", () => {
    expect(
      figmaMcpFromClaudeList("claude.ai Figma: https://mcp.figma.com/mcp - ✘ Failed to connect"),
    ).toBe("registered");
  });

  it("reports missing when no figma server is listed", () => {
    expect(figmaMcpFromClaudeList("plugin:github:github: … - ✔ Connected")).toBe("missing");
    expect(figmaMcpFromClaudeList("")).toBe("missing");
  });
});

describe("figmaMcpFromCodexList", () => {
  const table = [
    "Name   Url                        Bearer Token Env Var  Status   Auth ",
    "figma  https://mcp.figma.com/mcp  -                     enabled  OAuth",
  ].join("\n");

  it("treats an enabled figma row as connected", () => {
    expect(figmaMcpFromCodexList(table)).toBe("connected");
  });

  it("treats a disabled row as registered", () => {
    expect(
      figmaMcpFromCodexList("figma  https://mcp.figma.com/mcp  -  disabled  OAuth"),
    ).toBe("registered");
  });

  it("reports missing without a figma row", () => {
    expect(figmaMcpFromCodexList("Name  Url  Status\nother  https://x  enabled")).toBe("missing");
  });
});

describe("figmaMcpFromGeminiList", () => {
  it("detects disconnected vs connected", () => {
    expect(
      figmaMcpFromGeminiList(
        "Configured MCP servers:\n\n✗ figma: https://mcp.figma.com/mcp (http) - Disconnected",
      ),
    ).toBe("registered");
    expect(
      figmaMcpFromGeminiList("✓ figma: https://mcp.figma.com/mcp (http) - Connected"),
    ).toBe("connected");
    // 심볼 없는 포맷도 "Disconnected"에 속지 않아야 한다
    expect(figmaMcpFromGeminiList("figma: https://mcp.figma.com/mcp - Connected")).toBe(
      "connected",
    );
    expect(figmaMcpFromGeminiList("figma: https://mcp.figma.com/mcp - Disconnected")).toBe(
      "registered",
    );
  });

  it("reports missing when unregistered", () => {
    expect(figmaMcpFromGeminiList("Configured MCP servers:\n(none)")).toBe("missing");
  });
});
