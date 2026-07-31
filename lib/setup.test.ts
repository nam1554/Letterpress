import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { figmaMcpFromClaudeList, figmaMcpFromCodexList, figmaTokenStep } from "./setup";

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

describe("figmaTokenStep (토큰 전용 경로)", () => {
  let dir: string;
  const settingsPath = () => path.join(dir, "settings.json");

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mhm-setup-"));
    process.env.MHM_SETTINGS_FILE = settingsPath();
  });

  afterEach(async () => {
    delete process.env.MHM_SETTINGS_FILE;
    await rm(dir, { recursive: true, force: true });
  });

  it("토큰이 있으면 통과한다", async () => {
    await writeFile(settingsPath(), JSON.stringify({ figmaToken: "figd_test_token" }));
    const step = figmaTokenStep();
    expect(step.ok).toBe(true);
    expect(step.detail).toContain("토큰");
  });

  it("토큰이 없으면 실패로 표시하고 발급 위치를 안내한다", async () => {
    await writeFile(settingsPath(), JSON.stringify({}));
    const step = figmaTokenStep();
    expect(step.ok).toBe(false);
    // 팀원이 읽고 바로 행동할 수 있어야 한다.
    expect(step.hint ?? "").toMatch(/figma\.com/);
  });

  it("MCP를 대안으로 안내하지 않는다", async () => {
    await writeFile(settingsPath(), JSON.stringify({}));
    const step = figmaTokenStep();
    expect(`${step.detail} ${step.hint ?? ""} ${step.command ?? ""}`).not.toMatch(/mcp/i);
  });

  // 리뷰 Important 2: "아래 입력란에 저장하세요"는 이 브랜치에서 삭제된
  // GeminiKeyInput(같은 카드 안 입력란)의 잔재다. Figma 토큰 입력란은 지금
  // SettingsPanel.tsx에 있고 그 Section은 접힌 채로 시작하므로, 목적지를
  // 명시적으로 가리켜야 한다.
  it("목적지(⚙️ 설정 패널)를 명시하고, 사라진 '아래 입력란'을 가리키지 않는다", async () => {
    await writeFile(settingsPath(), JSON.stringify({}));
    const step = figmaTokenStep();
    expect(step.hint ?? "").toMatch(/설정/);
    expect(step.hint ?? "").not.toMatch(/아래 입력란/);
  });
});
