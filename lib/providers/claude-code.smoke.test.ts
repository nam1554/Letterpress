import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeProvider } from "./claude-code";
import type { AgentEvent } from "./types";

// Spawns the real `claude` CLI (uses the local subscription).
// Opt-in only: RUN_CLAUDE_SMOKE=1 pnpm vitest run lib/providers/claude-code.smoke.test.ts
describe.skipIf(!process.env.RUN_CLAUDE_SMOKE)("claude-code provider smoke", () => {
  it("spawns claude, streams events, and sees files it writes", { timeout: 120_000 }, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "mhm-smoke-"));
    const events: AgentEvent[] = [];

    const result = await claudeCodeProvider.run(
      {
        jobId: "smoke",
        figmaUrl: "https://www.figma.com/design/x/y",
        workDir,
        promptOverride:
          'Create a file at ./output/smoke.txt containing exactly the text "hello from claude". Then reply with one short sentence confirming it.',
      },
      (e) => events.push(e),
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(events.some((e) => e.type === "status")).toBe(true);
    const content = await readFile(path.join(workDir, "output", "smoke.txt"), "utf8");
    expect(content.trim()).toBe("hello from claude");
  });
});
