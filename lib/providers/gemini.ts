import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";

const GEMINI_BIN = process.env.GEMINI_BIN ?? "gemini";

function loggedIn(): boolean {
  if (process.env.GEMINI_API_KEY) return true;
  return existsSync(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
}

// gemini --output-format stream-json emits JSONL: session metadata, message
// chunks, tool call requests/results, errors, and a final result. The exact
// field names are not pinned by a published schema, so parsing is tolerant.
export interface GeminiLine {
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

const extractText = (line: GeminiLine): string =>
  line.text ?? line.delta ?? line.content ?? line.message ?? "";

/**
 * Stateful tolerant mapper: buffers message chunks into whole lines, captures
 * the final response and first error. Exported for unit tests.
 */
export function createGeminiLineMapper(onEvent: (e: AgentEvent) => void) {
  let textBuffer = "";
  let finalResponse = "";
  let errorText = "";

  const flush = () => {
    const text = textBuffer.trim();
    textBuffer = "";
    if (text) onEvent({ ts: Date.now(), type: "log", text });
  };

  return {
    handle(line: GeminiLine) {
      const type = line.type ?? "";
      if (type.includes("error") || line.error) {
        flush();
        errorText =
          typeof line.error === "string"
            ? line.error
            : (line.error?.message ?? extractText(line) ?? "unknown error");
        onEvent({ ts: Date.now(), type: "error", text: errorText });
      } else if (type.includes("tool")) {
        flush();
        const name = line.tool_name ?? line.name ?? "tool";
        onEvent({
          ts: Date.now(),
          type: "tool",
          text: `${name}${line.status ? ` (${line.status})` : ""}`,
        });
      } else if (type === "result" || line.response !== undefined) {
        flush();
        finalResponse = line.response ?? extractText(line);
      } else {
        // message chunks: buffer and emit per completed line
        textBuffer += extractText(line);
        const parts = textBuffer.split("\n");
        textBuffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.trim()) onEvent({ ts: Date.now(), type: "log", text: part.trim() });
        }
      }
    },
    finish() {
      flush();
      return { finalResponse, errorText };
    },
  };
}

export const geminiProvider: AgentProvider = {
  id: "gemini",
  label: "Gemini CLI (Google 계정)",

  async run(task, onEvent, signal): Promise<AgentResult> {
    if (!loggedIn()) {
      return {
        ok: false,
        summary:
          "Gemini CLI 로그인이 필요합니다. 터미널에서 `gemini`를 실행해 구글 계정으로 로그인하세요.",
      };
    }
    const prompt = task.promptOverride ?? buildEdmPrompt(task, "files");
    const mapper = createGeminiLineMapper(onEvent);

    const result = await runJsonlCli({
      bin: GEMINI_BIN,
      args: ["-p", prompt, "--approval-mode", "yolo", "--output-format", "stream-json"],
      cwd: task.workDir,
      env: agentEnv(),
      signal,
      onJson: (obj) => mapper.handle(obj as GeminiLine),
      onText: (raw) => onEvent({ ts: Date.now(), type: "log", text: raw }),
    });

    const { finalResponse, errorText } = mapper.finish();

    if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
    if (result.kind === "spawn-error") {
      const message = result.error?.message ?? "unknown";
      onEvent({ ts: Date.now(), type: "error", text: `gemini 실행 실패: ${message}` });
      return {
        ok: false,
        summary: `gemini CLI를 실행할 수 없습니다: ${message} (npm i -g @google/gemini-cli 후 첫 실행에서 구글 로그인)`,
      };
    }

    const fatal = finalResponse.trim().startsWith("FATAL:");
    const ok = result.code === 0 && !fatal && !errorText;
    return {
      ok,
      summary: ok
        ? finalResponse || "완료"
        : errorText || finalResponse || result.stderrTail || `종료 코드 ${result.code}`,
    };
  },
};
