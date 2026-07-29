import { getSettings } from "../settings";
import { runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

// claude -p --output-format stream-json line shapes (subset we care about).
export interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  result?: string;
  message?: {
    content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  };
}

/** Exported for unit tests. */
export function claudeEventsFromLine(line: ClaudeStreamLine): AgentEvent[] {
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

  async run(task, onEvent, signal): Promise<AgentResult> {
    const prompt = task.promptOverride ?? buildEdmPrompt(task);

    // Strip nested-session markers so the spawned CLI behaves like a fresh run.
    const env = agentEnv();
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    let resultText = "";
    let sawSuccess = false;

    // 설정된 모델(예: haiku)로 실험할 수 있게 한다 — 빈 값이면 CLI 기본.
    const model = getSettings().claudeModel;
    const result = await runJsonlCli({
      bin: CLAUDE_BIN,
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        ...(model ? ["--model", model] : []),
      ],
      cwd: task.workDir,
      env,
      signal,
      onJson: (obj) => {
        const line = obj as ClaudeStreamLine;
        if (line.type === "result") {
          sawSuccess = line.subtype === "success";
          resultText = line.result ?? "";
        }
        for (const e of claudeEventsFromLine(line)) onEvent(e);
      },
      onText: (raw) => onEvent({ ts: Date.now(), type: "log", text: raw }),
    });

    if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
    if (result.kind === "spawn-error") {
      const message = result.error?.message ?? "unknown";
      onEvent({ ts: Date.now(), type: "error", text: `claude 실행 실패: ${message}` });
      return { ok: false, summary: `claude CLI를 실행할 수 없습니다: ${message}` };
    }

    const fatal = resultText.startsWith("FATAL:");
    const ok = result.code === 0 && sawSuccess && !fatal;
    return {
      ok,
      summary: ok
        ? resultText || "완료"
        : resultText || result.stderrTail || (result.signal ? `프로세스가 ${result.signal} 신호로 종료되었습니다.` : `종료 코드 ${result.code}`),
    };
  },
};
