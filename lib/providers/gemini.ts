import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentProvider, AgentResult, AgentTask } from "./types";

const GEMINI_BIN = process.env.GEMINI_BIN ?? "gemini";

function loggedIn(): boolean {
  if (process.env.GEMINI_API_KEY) return true;
  return existsSync(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
}

// gemini --output-format stream-json emits JSONL: session metadata, message
// chunks, tool call requests/results, errors, and a final result. The exact
// field names are not pinned by a published schema, so parsing is tolerant:
// known shapes become typed events, text chunks are line-buffered, and the
// final response is captured for the job summary.
interface GeminiLine {
  type?: string;
  text?: string;
  message?: string;
  delta?: string;
  content?: string;
  response?: string;
  error?: { message?: string } | string;
  tool_name?: string;
  name?: string;
  status?: string;
}

function extractText(line: GeminiLine): string {
  return line.text ?? line.delta ?? line.content ?? line.message ?? "";
}

export const geminiProvider: AgentProvider = {
  id: "gemini",
  label: "Gemini CLI (Google 계정)",

  async run(task: AgentTask, onEvent, signal): Promise<AgentResult> {
    if (!loggedIn()) {
      return {
        ok: false,
        summary:
          "Gemini CLI 로그인이 필요합니다. 터미널에서 `gemini`를 실행해 구글 계정으로 로그인하세요.",
      };
    }
    const prompt = task.promptOverride ?? buildEdmPrompt(task, "files");

    return new Promise((resolve) => {
      const child = spawn(
        GEMINI_BIN,
        ["-p", prompt, "--approval-mode", "yolo", "--output-format", "stream-json"],
        // stdin must be closed: -p appends stdin input, so a pipe would block.
        { cwd: task.workDir, env: agentEnv(), signal, stdio: ["ignore", "pipe", "pipe"] },
      );

      let finalResponse = "";
      let errorText = "";
      let stderrTail = "";
      let buffer = "";
      let textBuffer = "";

      const flushText = () => {
        const text = textBuffer.trim();
        textBuffer = "";
        if (text) onEvent({ ts: Date.now(), type: "log", text });
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          let parsed: GeminiLine;
          try {
            parsed = JSON.parse(raw);
          } catch {
            onEvent({ ts: Date.now(), type: "log", text: raw });
            continue;
          }

          const type = parsed.type ?? "";
          if (type.includes("error") || parsed.error) {
            flushText();
            errorText =
              typeof parsed.error === "string"
                ? parsed.error
                : (parsed.error?.message ?? extractText(parsed) ?? "unknown error");
            onEvent({ ts: Date.now(), type: "error", text: errorText });
          } else if (type.includes("tool")) {
            flushText();
            const name = parsed.tool_name ?? parsed.name ?? "tool";
            onEvent({ ts: Date.now(), type: "tool", text: `${name}${parsed.status ? ` (${parsed.status})` : ""}` });
          } else if (type === "result" || parsed.response !== undefined) {
            flushText();
            finalResponse = parsed.response ?? extractText(parsed);
          } else {
            // message chunks: buffer and emit per completed line
            textBuffer += extractText(parsed);
            const parts = textBuffer.split("\n");
            textBuffer = parts.pop() ?? "";
            for (const part of parts) {
              if (part.trim()) onEvent({ ts: Date.now(), type: "log", text: part.trim() });
            }
          }
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
        onEvent({ ts: Date.now(), type: "error", text: `gemini 실행 실패: ${err.message}` });
        resolve({
          ok: false,
          summary: `gemini CLI를 실행할 수 없습니다: ${err.message} (npm i -g @google/gemini-cli 후 첫 실행에서 구글 로그인)`,
        });
      });

      child.on("close", (code) => {
        flushText();
        const last = finalResponse || textBuffer;
        const fatal = last.trim().startsWith("FATAL:");
        const ok = code === 0 && !fatal && !errorText;
        resolve({
          ok,
          summary: ok ? last || "완료" : errorText || last || stderrTail || `종료 코드 ${code}`,
        });
      });
    });
  },
};
