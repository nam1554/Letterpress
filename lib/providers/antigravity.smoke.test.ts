import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { antigravityProvider } from "./antigravity";
import type { AgentEvent } from "./types";

// Spawns the real `agy` CLI (uses the Google subscription — burns quota).
// Opt-in only: RUN_ANTIGRAVITY_SMOKE=1 pnpm exec vitest run lib/providers/antigravity.smoke.test.ts
describe.skipIf(!process.env.RUN_ANTIGRAVITY_SMOKE)("antigravity provider smoke", () => {
  it("spawns agy, streams events, and writes into workDir", { timeout: 300_000 }, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "mhm-agy-smoke-"));
    const events: AgentEvent[] = [];

    const result = await antigravityProvider.run(
      {
        jobId: "smoke",
        figmaUrl: "https://www.figma.com/design/x/y",
        workDir,
        promptOverride:
          'Create a file at ./output/smoke.txt containing exactly the text "hello from agy". Then reply with one short sentence confirming it.',
      },
      (e) => events.push(e),
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    // --add-dir이 빠지면 agy가 자기 스크래치에 쓰고 이 읽기가 ENOENT로 실패한다.
    const content = await readFile(path.join(workDir, "output", "smoke.txt"), "utf8");
    expect(content.trim()).toBe("hello from agy");
  });
});
