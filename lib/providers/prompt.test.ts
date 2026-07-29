import { describe, expect, it } from "vitest";
import { buildEdmPrompt } from "./prompt";
import type { AgentTask } from "./types";

const base: AgentTask = {
  jobId: "deadbeef",
  figmaUrl: "https://www.figma.com/design/abc/?node-id=1-2",
  workDir: "/tmp/work",
};

describe("buildEdmPrompt", () => {
  it("states the deliverable contract and iteration budget", () => {
    const p = buildEdmPrompt(base, "claude-skill");
    expect(p).toContain("verify.json");
    expect(p).toContain("Iteration budget");
    expect(p).toContain("no node-id");
    expect(p).not.toContain("REPAIR RUN");
  });

  it("appends the repair appendix with the gate failures", () => {
    const p = buildEdmPrompt(
      { ...base, repair: { failures: ["output/에 *_figma.html이 없습니다."] } },
      "files",
    );
    expect(p).toContain("REPAIR RUN");
    expect(p).toContain("output/에 *_figma.html이 없습니다.");
  });

  it("switches to the edit prompt when task.edit is set", () => {
    const p = buildEdmPrompt(
      { ...base, edit: { instruction: "헤드라인을 'B'로 바꿔줘" } },
      "claude-skill",
    );
    expect(p).toContain("ALREADY BUILT");
    expect(p).toContain("헤드라인을 'B'로 바꿔줘");
    expect(p).toContain("Adapting when copy or design changes");
    expect(p).not.toContain("Iteration budget");
  });
});
