import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: vi.fn(), on: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-notify-"));
  process.env.MHM_SETTINGS_FILE = path.join(dir, "settings.json");
});

afterAll(async () => {
  delete process.env.MHM_SETTINGS_FILE;
  await rm(dir, { recursive: true, force: true });
});

import { notifyJobFinished } from "./notify";
import { saveSettings } from "../settings";

describe("notifyJobFinished", () => {
  beforeEach(() => {
    spawnMock.mockClear();
    saveSettings({ notifyOnFinish: true });
  });

  it("spawns osascript once on finish (macOS)", () => {
    if (process.platform !== "darwin") return; // darwin 전용 경로
    notifyJobFinished({ id: "abc12345", status: "succeeded", title: "테스트 eDM" });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe("osascript");
    expect(String(spawnMock.mock.calls[0][1])).toContain("테스트 eDM");
  });

  it("does nothing when notifyOnFinish is off", () => {
    saveSettings({ notifyOnFinish: false });
    notifyJobFinished({ id: "abc12345", status: "failed" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("never throws even if spawn does", () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => notifyJobFinished({ id: "abc12345", status: "failed" })).not.toThrow();
  });
});
