import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexProvider } from "./codex";
import type { AgentEvent } from "./types";

// Spawns the real `codex` CLI (uses the ChatGPT subscription).
// Opt-in only: RUN_CODEX_SMOKE=1 pnpm vitest run lib/providers/codex.smoke.test.ts
describe.skipIf(!process.env.RUN_CODEX_SMOKE)("codex provider smoke", () => {
  it("spawns codex, streams events, and sees files it writes", { timeout: 180_000 }, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "mhm-codex-smoke-"));
    const events: AgentEvent[] = [];

    const result = await codexProvider.run(
      {
        jobId: "smoke",
        figmaUrl: "https://www.figma.com/design/x/y",
        workDir,
        promptOverride:
          'Create a file at ./output/smoke.txt containing exactly the text "hello from codex". Then reply with one short sentence confirming it.',
      },
      (e) => events.push(e),
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    const content = await readFile(path.join(workDir, "output", "smoke.txt"), "utf8");
    expect(content.trim()).toBe("hello from codex");
  });
});
