import { spawn } from "node:child_process";
import type { AgentEvent, AgentProvider, AgentResult, AgentTask } from "./types";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

function buildPrompt(task: AgentTask): string {
  return `You are converting a Figma eDM design into email HTML.

Figma design URL: ${task.figmaUrl}

Use the "figma-edm" skill and follow its full pipeline (pull the frame via the
Figma MCP tools, build email-safe table HTML, verify pixel fidelity, add the
responsive variant). Set EDM_DIR to the current working directory.

Requirements:
- Write ALL final deliverables into ./output/ (create it):
  - the Figma-identical HTML (*_figma.html)
  - the responsive HTML (*_responsive.html)
  - an images/ folder with every image used, so the HTML can be re-hosted on a CDN
    (like the reference package: relative <img src="images/...">, plus a
    self-contained preview variant if the skill produces one)
- If the Figma MCP tools are NOT available in this session, do not improvise:
  print a single line starting with "FATAL:" explaining what is missing, and exit.
- Print short progress lines as you complete each pipeline step.
- Finish with a one-paragraph summary of what was produced and the verify result.`;
}

interface StreamLine {
  type?: string;
  subtype?: string;
  result?: string;
  message?: {
    content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  };
}

function eventsFromLine(line: StreamLine): AgentEvent[] {
  const now = Date.now();
  const events: AgentEvent[] = [];
  if (line.type === "system" && line.subtype === "init") {
    events.push({ ts: now, type: "status", text: "Claude Code 세션 시작" });
  } else if (line.type === "assistant") {
    for (const block of line.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) {
        events.push({ ts: now, type: "log", text: block.text.trim() });
      } else if (block.type === "tool_use" && block.name) {
        const input = JSON.stringify(block.input ?? {});
        const short = input.length > 200 ? `${input.slice(0, 200)}…` : input;
        events.push({ ts: now, type: "tool", text: `${block.name} ${short}` });
      }
    }
  } else if (line.type === "result") {
    const ok = line.subtype === "success";
    events.push({
      ts: now,
      type: ok ? "status" : "error",
      text: ok ? "에이전트 실행 완료" : `에이전트 종료: ${line.subtype}`,
    });
  }
  return events;
}

export const claudeCodeProvider: AgentProvider = {
  id: "claude-code",
  label: "Claude Code (local CLI)",

  run(task, onEvent, signal): Promise<AgentResult> {
    const prompt = task.promptOverride ?? buildPrompt(task);

    // Strip nested-session markers so the spawned CLI behaves like a fresh run.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    return new Promise((resolve) => {
      const child = spawn(
        CLAUDE_BIN,
        [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "bypassPermissions",
        ],
        { cwd: task.workDir, env, signal },
      );

      let resultText = "";
      let sawSuccess = false;
      let stderrTail = "";
      let buffer = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          let parsed: StreamLine;
          try {
            parsed = JSON.parse(raw);
          } catch {
            onEvent({ ts: Date.now(), type: "log", text: raw });
            continue;
          }
          if (parsed.type === "result") {
            sawSuccess = parsed.subtype === "success";
            resultText = parsed.result ?? "";
          }
          for (const e of eventsFromLine(parsed)) onEvent(e);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-2000);
      });

      child.on("error", (err) => {
        onEvent({ ts: Date.now(), type: "error", text: `claude 실행 실패: ${err.message}` });
        resolve({ ok: false, summary: `claude CLI를 실행할 수 없습니다: ${err.message}` });
      });

      child.on("close", (code) => {
        const fatal = resultText.startsWith("FATAL:");
        const ok = code === 0 && sawSuccess && !fatal;
        resolve({
          ok,
          summary: ok
            ? resultText || "완료"
            : resultText || stderrTail || `종료 코드 ${code}`,
        });
      });
    });
  },
};
