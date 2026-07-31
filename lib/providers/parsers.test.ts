import { describe, expect, it } from "vitest";
import { createAgyLineMapper, stripAgySystemNoise } from "./antigravity";
import { claudeEventsFromLine } from "./claude-code";
import { codexEventsFromLine } from "./codex";
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

describe("antigravity(agy) stream-json mapper", () => {
  const collect = () => {
    const events: AgentEvent[] = [];
    return { events, mapper: createAgyLineMapper((e) => events.push(e)) };
  };

  it("init을 세션 시작 상태로 바꾼다", () => {
    const { events, mapper } = collect();
    mapper.handle({ event: "init", conversation_id: "c1", init: { cwd: "/tmp/x" } });
    expect(events).toEqual([expect.objectContaining({ type: "status" })]);
    expect(events[0].text).toContain("Antigravity");
  });

  it("agent_response의 text_delta를 완성된 줄 단위로만 흘린다", () => {
    const { events, mapper } = collect();
    mapper.handle({
      event: "step_update",
      step_update: { state: "ACTIVE", step_type: "agent_response", text_delta: "첫 줄\n둘째 " },
    });
    expect(events.map((e) => e.text)).toEqual(["첫 줄"]);
    mapper.handle({
      event: "step_update",
      step_update: { state: "ACTIVE", step_type: "agent_response", text_delta: "줄\n" },
    });
    expect(events.map((e) => e.text)).toEqual(["첫 줄", "둘째 줄"]);
  });

  it("툴은 DONE 시점에만 한 줄 남긴다 (ACTIVE는 무시)", () => {
    const { events, mapper } = collect();
    mapper.handle({
      event: "step_update",
      step_update: { state: "ACTIVE", step_type: "tool", tool_name: "run_command" },
    });
    expect(events).toHaveLength(0);
    mapper.handle({
      event: "step_update",
      step_update: { state: "DONE", step_type: "tool", tool_name: "run_command" },
    });
    expect(events).toEqual([expect.objectContaining({ type: "tool", text: "run_command" })]);
  });

  it("result 성공에서 최종 응답을 얻는다", () => {
    const { mapper } = collect();
    mapper.handle({ event: "result", result: { status: "SUCCESS", response: "eDM 빌드 완료" } });
    expect(mapper.finish()).toEqual({ finalResponse: "eDM 빌드 완료", errorText: "" });
  });

  // 실측: 프롬프트가 FATAL을 찍어도 status는 SUCCESS다. 파서는 응답을 그대로
  // 넘기고, 성공 판정은 provider가 FATAL 접두어로 한다.
  it("FATAL 응답도 status가 SUCCESS면 에러로 만들지 않는다", () => {
    const { events, mapper } = collect();
    mapper.handle({
      event: "result",
      result: { status: "SUCCESS", response: "FATAL: Figma access is not available\n" },
    });
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(mapper.finish().finalResponse).toContain("FATAL:");
  });

  it("status가 SUCCESS가 아니면 에러로 남긴다", () => {
    const { events, mapper } = collect();
    mapper.handle({ event: "result", result: { status: "ERROR", response: "quota exhausted" } });
    expect(events).toEqual([expect.objectContaining({ type: "error" })]);
    expect(mapper.finish().errorText).toContain("quota exhausted");
  });

  // 리뷰 Minor 3: status 필드 자체가 없을 때 조용히 성공으로 흘리면 스키마가
  // 어긋난 응답을 통과시킨다. 실측에선 항상 있었지만 방어는 싸다.
  it("result에 status 필드가 아예 없으면 방어적으로 에러 취급한다", () => {
    const { events, mapper } = collect();
    mapper.handle({ event: "result", result: { response: "뭔가 응답" } });
    expect(events).toEqual([expect.objectContaining({ type: "error" })]);
    expect(mapper.finish().errorText).toContain("뭔가 응답");
  });

  it("버퍼에 남은 마지막 줄을 finish에서 흘린다", () => {
    const { events, mapper } = collect();
    mapper.handle({
      event: "step_update",
      step_update: { state: "ACTIVE", step_type: "agent_response", text_delta: "개행 없는 줄" },
    });
    expect(events).toHaveLength(0);
    mapper.finish();
    expect(events.map((e) => e.text)).toEqual(["개행 없는 줄"]);
  });

  it("모르는 event와 잡다한 step_type은 조용히 무시한다", () => {
    const { events, mapper } = collect();
    mapper.handle({ event: "telemetry_whatever" });
    mapper.handle({ event: "step_update", step_update: { state: "DONE", step_type: "checkpoint" } });
    mapper.handle({ event: "step_update", step_update: { state: "DONE", step_type: "user_input" } });
    expect(events).toHaveLength(0);
  });
});

describe("stripAgySystemNoise", () => {
  // 실측 응답에 그대로 들어 있던 모양이다.
  it("SYSTEM_MESSAGE 블록을 통째로 걷어낸다", () => {
    const raw = [
      "빌드를 완료했습니다.",
      "<SYSTEM_MESSAGE>",
      "[Message] timestamp=2026-07-31T06:43:08Z sender=b0ff/task-55 priority=HIGH content=…",
      "Log: file:///Users/example/.gemini/antigravity-cli/brain/…/task-55.log",
      "</SYSTEM_MESSAGE>",
      "verify.json은 PASS입니다.",
    ].join("\n");
    const out = stripAgySystemNoise(raw);
    expect(out).toContain("빌드를 완료했습니다.");
    expect(out).toContain("verify.json은 PASS입니다.");
    expect(out).not.toContain("SYSTEM_MESSAGE");
    expect(out).not.toContain("task-55");
  });

  it("'production mode active' 줄을 걷어낸다", () => {
    expect(stripAgySystemNoise("... production mode active ...\n결과입니다.").trim()).toBe(
      "결과입니다.",
    );
  });

  // run3(/tmp/agy-stream-run3.ndjson) 실측 모양 — SYSTEM_MESSAGE가 아니라
  // <notification> 블록이었다. 내부 task id와 절대 로그 경로가 그대로 실린다.
  it("notification 블록을 통째로 걷어낸다 (task id·절대경로 포함)", () => {
    const raw = [
      "빌드를 완료했습니다.",
      "<notification>",
      "Task cd5e3158-9220-4899-b093-c59f2d15c1a6/task-28 has completed.",
      "Log: /Users/example/.gemini/antigravity-cli/brain/cd5e3158-.../.system_generated/tasks/task-32.log",
      "Output:",
      "Downloaded figma_full.png: (700, 2158)",
      "</notification>",
      "verify.json은 PASS입니다.",
    ].join("\n");
    const out = stripAgySystemNoise(raw);
    expect(out).toContain("빌드를 완료했습니다.");
    expect(out).toContain("verify.json은 PASS입니다.");
    expect(out).not.toContain("notification");
    expect(out).not.toContain("task-28");
    expect(out).not.toContain("task-32");
    expect(out).not.toContain(".system_generated");
    expect(out).not.toContain("cd5e3158");
  });

  it("SYSTEM_MESSAGE가 여러 번 나와도 전부 걷어낸다", () => {
    const raw = "A\n<SYSTEM_MESSAGE>\nx\n</SYSTEM_MESSAGE>\nB\n<SYSTEM_MESSAGE>\ny\n</SYSTEM_MESSAGE>\nC";
    const out = stripAgySystemNoise(raw);
    expect(out).not.toContain("x");
    expect(out).not.toContain("y");
    expect(out.replace(/\n+/g, " ").trim()).toBe("A B C");
  });

  it("잡음이 없으면 원문을 그대로 둔다", () => {
    expect(stripAgySystemNoise("평범한 요약입니다.")).toBe("평범한 요약입니다.");
  });
});
