import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult, AgentTask } from "./types";

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
interface CodexLine {
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

function eventsFromLine(line: CodexLine): AgentEvent[] {
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
          return [{ ts: now, type: "tool", text: `$ ${item.command ?? ""} (exit ${item.exit_code ?? "?"})` }];
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

  async run(task: AgentTask, onEvent, signal): Promise<AgentResult> {
    if (!(await loggedIn())) {
      return {
        ok: false,
        summary: "Codex CLI 로그인이 필요합니다. 터미널에서 `codex login`을 실행하세요.",
      };
    }
    const prompt = task.promptOverride ?? buildEdmPrompt(task, "files");

    return new Promise((resolve) => {
      const child = spawn(
        CODEX_BIN,
        [
          "exec",
          "--json",
          // The job needs real shell/network/Chrome access; the app itself is local-only.
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          prompt,
        ],
        // stdin must be closed: codex exec waits for stdin EOF on a pipe.
        { cwd: task.workDir, env: agentEnv(), signal, stdio: ["ignore", "pipe", "pipe"] },
      );

      let lastMessage = "";
      let errorText = "";
      let stderrTail = "";
      let buffer = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          let parsed: CodexLine;
          try {
            parsed = JSON.parse(raw);
          } catch {
            onEvent({ ts: Date.now(), type: "log", text: raw });
            continue;
          }
          if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
            lastMessage = parsed.item.text ?? lastMessage;
          }
          if (parsed.type === "turn.failed" || parsed.type === "error") {
            errorText =
              typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "");
          }
          for (const e of eventsFromLine(parsed)) onEvent(e);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-2000);
      });

      child.on("error", (err) => {
        if (signal.aborted) {
          resolve({ ok: false, summary: "사용자가 취소했습니다." });
          return;
        }
        onEvent({ ts: Date.now(), type: "error", text: `codex 실행 실패: ${err.message}` });
        resolve({
          ok: false,
          summary: `codex CLI를 실행할 수 없습니다: ${err.message} (npm i -g @openai/codex, codex login)`,
        });
      });

      child.on("close", (code) => {
        const fatal = lastMessage.trim().startsWith("FATAL:");
        const ok = code === 0 && !fatal && !errorText;
        resolve({
          ok,
          summary: ok
            ? lastMessage || "완료"
            : errorText || lastMessage || stderrTail || `종료 코드 ${code}`,
        });
      });
    });
  },
};
