import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const execFileAsync = promisify(execFile);

// Unauthenticated `codex exec` hangs silently instead of failing — check first.
async function loggedIn(): Promise<boolean> {
  try {
    await execFileAsync(CODEX_BIN, ["login", "status"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// codex exec --json JSONL schema (codex-rs/exec/src/exec_events.rs):
// {type: "thread.started"|"turn.started"|"turn.completed"|"turn.failed"|"item.completed"|"error", ...}
export interface CodexLine {
  type?: string;
  error?: { message?: string } | string;
  usage?: { input_tokens?: number; output_tokens?: number };
  item?: {
    type?: string;
    text?: string;
    command?: string;
    exit_code?: number;
    server?: string;
    tool?: string;
    query?: string;
  };
}

/** Exported for unit tests. */
export function codexEventsFromLine(line: CodexLine): AgentEvent[] {
  const now = Date.now();
  const item = line.item;
  switch (line.type) {
    case "thread.started":
      return [{ ts: now, type: "status", text: "Codex 세션 시작" }];
    case "turn.failed":
    case "error": {
      const msg =
        typeof line.error === "string" ? line.error : (line.error?.message ?? "unknown error");
      return [{ ts: now, type: "error", text: msg }];
    }
    case "item.completed":
      switch (item?.type) {
        case "agent_message":
          return item.text?.trim() ? [{ ts: now, type: "log", text: item.text.trim() }] : [];
        case "command_execution":
          return [
            { ts: now, type: "tool", text: `$ ${item.command ?? ""} (exit ${item.exit_code ?? "?"})` },
          ];
        case "mcp_tool_call":
          return [{ ts: now, type: "tool", text: `${item.server ?? "mcp"}.${item.tool ?? "?"}` }];
        case "web_search":
          return [{ ts: now, type: "tool", text: `search: ${item.query ?? ""}` }];
        default:
          return []; // reasoning/file_change: too noisy for the job log
      }
    default:
      return [];
  }
}

export const codexProvider: AgentProvider = {
  id: "codex",
  label: "Codex CLI (ChatGPT 구독)",

  async run(task, onEvent, signal): Promise<AgentResult> {
    if (!(await loggedIn())) {
      return {
        ok: false,
        summary: "Codex CLI 로그인이 필요합니다. 터미널에서 `codex login`을 실행하세요.",
      };
    }
    const prompt = task.promptOverride ?? buildEdmPrompt(task, "files");

    let lastMessage = "";
    let errorText = "";

    const result = await runJsonlCli({
      bin: CODEX_BIN,
      args: [
        "exec",
        "--json",
        // The job needs real shell/network/Chrome access; the app itself is local-only.
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        prompt,
      ],
      cwd: task.workDir,
      env: agentEnv(),
      signal,
      onJson: (obj) => {
        const line = obj as CodexLine;
        if (line.type === "item.completed" && line.item?.type === "agent_message") {
          lastMessage = line.item.text ?? lastMessage;
        }
        if (line.type === "turn.failed" || line.type === "error") {
          errorText = typeof line.error === "string" ? line.error : (line.error?.message ?? "");
        }
        for (const e of codexEventsFromLine(line)) onEvent(e);
      },
      onText: (raw) => onEvent({ ts: Date.now(), type: "log", text: raw }),
    });

    if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
    if (result.kind === "spawn-error") {
      const message = result.error?.message ?? "unknown";
      onEvent({ ts: Date.now(), type: "error", text: `codex 실행 실패: ${message}` });
      return {
        ok: false,
        summary: `codex CLI를 실행할 수 없습니다: ${message} (npm i -g @openai/codex, codex login)`,
      };
    }

    const fatal = lastMessage.trim().startsWith("FATAL:");
    const ok = result.code === 0 && !fatal && !errorText;
    return {
      ok,
      summary: ok
        ? lastMessage || "완료"
        : errorText || lastMessage || result.stderrTail || `종료 코드 ${result.code}`,
    };
  },
};
