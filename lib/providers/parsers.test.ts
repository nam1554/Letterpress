import { describe, expect, it } from "vitest";
import { claudeEventsFromLine } from "./claude-code";
import { codexEventsFromLine } from "./codex";
import { createGeminiLineMapper } from "./gemini";
import type { AgentEvent } from "./types";

describe("claude stream-json parser", () => {
  it("maps init / text / tool_use / result lines", () => {
    expect(claudeEventsFromLine({ type: "system", subtype: "init" })[0]).toMatchObject({
      type: "status",
    });
    expect(
      claudeEventsFromLine({
        type: "assistant",
        message: { content: [{ type: "text", text: "  진행 중  " }] },
      })[0],
    ).toMatchObject({ type: "log", text: "진행 중" });

    const [tool] = claudeEventsFromLine({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
    });
    expect(tool.type).toBe("tool");
    expect(tool.text).toContain("Bash");

    expect(claudeEventsFromLine({ type: "result", subtype: "success" })[0]).toMatchObject({
      type: "status",
    });
    expect(claudeEventsFromLine({ type: "result", subtype: "error_max_turns" })[0]).toMatchObject({
      type: "error",
    });
  });

  it("truncates huge tool inputs", () => {
    const [tool] = claudeEventsFromLine({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { c: "x".repeat(500) } }] },
    });
    expect(tool.text.length).toBeLessThan(300);
  });

  it("ignores unknown line types", () => {
    expect(claudeEventsFromLine({ type: "user" })).toEqual([]);
    expect(claudeEventsFromLine({})).toEqual([]);
  });
});

describe("codex exec --json parser", () => {
  it("maps thread.started / items / failures", () => {
    expect(codexEventsFromLine({ type: "thread.started" })[0]).toMatchObject({ type: "status" });
    expect(
      codexEventsFromLine({
        type: "item.completed",
        item: { type: "agent_message", text: "done" },
      })[0],
    ).toMatchObject({ type: "log", text: "done" });
    expect(
      codexEventsFromLine({
        type: "item.completed",
        item: { type: "command_execution", command: "ls", exit_code: 0 },
      })[0].text,
    ).toBe("$ ls (exit 0)");
    expect(
      codexEventsFromLine({
        type: "item.completed",
        item: { type: "mcp_tool_call", server: "figma", tool: "get_screenshot" },
      })[0].text,
    ).toBe("figma.get_screenshot");
    expect(codexEventsFromLine({ type: "turn.failed", error: { message: "boom" } })[0]).toMatchObject(
      { type: "error", text: "boom" },
    );
    expect(codexEventsFromLine({ type: "error", error: "quota" })[0].text).toBe("quota");
  });

  it("drops noisy items and unknown types", () => {
    expect(
      codexEventsFromLine({ type: "item.completed", item: { type: "reasoning", text: "hmm" } }),
    ).toEqual([]);
    expect(codexEventsFromLine({ type: "turn.completed" })).toEqual([]);
    expect(codexEventsFromLine({})).toEqual([]);
  });
});

describe("gemini tolerant line mapper", () => {
  function collect() {
    const events: AgentEvent[] = [];
    const mapper = createGeminiLineMapper((e) => events.push(e));
    return { events, mapper };
  }

  it("buffers message chunks into whole lines", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "message", text: "첫 " });
    mapper.handle({ type: "message", text: "줄\n둘째 " });
    expect(events.map((e) => e.text)).toEqual(["첫 줄"]);
    const { finalResponse } = mapper.finish();
    expect(events.map((e) => e.text)).toEqual(["첫 줄", "둘째"]);
    expect(finalResponse).toBe("");
  });

  it("captures final response and error", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "tool_call", tool_name: "run_shell", status: "ok" });
    mapper.handle({ type: "result", response: "다 됐습니다" });
    mapper.handle({ type: "error", error: { message: "rate limit" } });
    const { finalResponse, errorText } = mapper.finish();
    expect(finalResponse).toBe("다 됐습니다");
    expect(errorText).toBe("rate limit");
    expect(events.some((e) => e.type === "tool" && e.text.includes("run_shell"))).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
