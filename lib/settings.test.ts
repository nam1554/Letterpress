import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let file: string;

beforeAll(() => {
  file = path.join(mkdtempSync(path.join(tmpdir(), "mhm-settings-")), "settings.json");
  process.env.MHM_SETTINGS_FILE = file;
});

afterAll(() => {
  delete process.env.MHM_SETTINGS_FILE;
});

describe("settings 저장", () => {
  it("토큰이 담기는 파일은 소유자만 읽을 수 있다", async () => {
    const { saveSettings } = await import("./settings");
    saveSettings({ figmaToken: "figd_probe_token" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("부분 저장이 나머지 설정을 보존한다", async () => {
    const { getSettings, saveSettings } = await import("./settings");
    saveSettings({ figmaToken: "figd_keep_me", cdnTemplate: "https://cdn.x/{file}" });
    saveSettings({ maxConcurrentJobs: 3 });
    const s = getSettings();
    expect(s.figmaToken).toBe("figd_keep_me");
    expect(s.cdnTemplate).toBe("https://cdn.x/{file}");
    expect(s.maxConcurrentJobs).toBe(3);
  });

  it("손상된 파일을 덮어쓰기 전에 옆으로 치운다", async () => {
    // 실측(2026-08-08): 손상 상태에서 아무 설정이나 저장하면 stored()가 {}를
    // 돌려주는 탓에 patch만 남고 Figma 토큰·CDN 템플릿이 조용히 사라졌다.
    const { getSettings, saveSettings } = await import("./settings");
    saveSettings({ figmaToken: "figd_before_corruption" });
    writeFileSync(file, "{ 깨진 JSON", { mode: 0o600 });

    // 손상 파일은 읽는 시점에 보존된다 — 값 자체는 되찾을 수 있어야 한다.
    expect(getSettings().maxConcurrentJobs).toBe(2); // 기본값 폴백
    expect(existsSync(`${file}.corrupt`)).toBe(true);
    expect(readFileSync(`${file}.corrupt`, "utf8")).toBe("{ 깨진 JSON");

    // 그 뒤의 저장은 정상 진행된다(사용자를 막지 않는다).
    saveSettings({ claudeModel: "haiku" });
    expect(getSettings().claudeModel).toBe("haiku");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ claudeModel: "haiku" });
  });

  it("파일이 아예 없으면 손상 백업을 만들지 않는다", async () => {
    const fresh = path.join(mkdtempSync(path.join(tmpdir(), "mhm-settings2-")), "settings.json");
    process.env.MHM_SETTINGS_FILE = fresh;
    try {
      const { getSettings } = await import("./settings");
      expect(getSettings().defaultProvider).toBe("claude-code");
      expect(existsSync(`${fresh}.corrupt`)).toBe(false);
    } finally {
      process.env.MHM_SETTINGS_FILE = file;
    }
  });
});
