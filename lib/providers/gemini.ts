import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSettings } from "../settings";
import { runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";

const GEMINI_BIN = process.env.GEMINI_BIN ?? "gemini";
// 기본 pro 모델은 무료 API 키에서 용량 제한(503)이 잦다 — flash 계열이 안정적.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

// 2026-07 확인: 개인 무료 Code Assist 티어가 Gemini CLI에서 중단됨
// (UNSUPPORTED_CLIENT). 실질 인증 경로는 API 키(설정 또는 env).
function loggedIn(): boolean {
  if (getSettings().geminiApiKey || process.env.GEMINI_API_KEY) return true;
  return existsSync(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
}

// gemini --output-format stream-json 실측 스키마 (v0.53, 2026-07-29 관측):
//   {type:"init", session_id, model}
//   {type:"message", role:"user"|"assistant", content:"..."}
//   {type:"result", status:"success"|"error", error?:{type,message}, stats:{...}}
// 툴 호출 이벤트는 아직 미관측 — 그 부분은 관용 매칭을 유지한다.
export interface GeminiLine {
  type?: string;
  role?: string;
  text?: string;
  message?: string;
  /** 실측: 스트리밍 청크 여부 플래그 (boolean). */
  delta?: boolean;
  content?: string;
  response?: string;
  status?: string;
  error?: { message?: string } | string;
  tool_name?: string;
  name?: string;
}

// 문자열 필드만 텍스트로 취급한다 (delta 같은 플래그가 섞이지 않도록).
const extractText = (line: GeminiLine): string => {
  for (const v of [line.text, line.content, line.message]) {
    if (typeof v === "string") return v;
  }
  return "";
};

/**
 * Stateful tolerant mapper: buffers message chunks into whole lines, captures
 * the final response and first error. Exported for unit tests.
 */
export function createGeminiLineMapper(onEvent: (e: AgentEvent) => void) {
  let textBuffer = "";
  let finalResponse = "";
  let errorText = "";
  let lastAssistantText = "";

  const flush = () => {
    const text = textBuffer.trim();
    textBuffer = "";
    if (text) onEvent({ ts: Date.now(), type: "log", text });
  };

  return {
    handle(line: GeminiLine) {
      const type = line.type ?? "";
      if (type === "init") {
        onEvent({ ts: Date.now(), type: "status", text: "Gemini 세션 시작" });
      } else if (type === "message" && line.role === "user") {
        // 프롬프트 에코 — 로그에 노이즈라 버린다.
      } else if (type === "result") {
        flush();
        if (line.status === "error" || line.error) {
          errorText =
            typeof line.error === "string"
              ? line.error
              : (line.error?.message ?? "unknown error");
          onEvent({ ts: Date.now(), type: "error", text: errorText });
        } else {
          finalResponse = line.response ?? finalResponse;
        }
      } else if (type.includes("error") || line.error) {
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
        const text = extractText(line);
        if (text.trim()) lastAssistantText = text.trim();
        textBuffer += text;
        const parts = textBuffer.split("\n");
        textBuffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.trim()) onEvent({ ts: Date.now(), type: "log", text: part.trim() });
        }
      }
    },
    finish() {
      flush();
      // result.response가 없으면 마지막 assistant 메시지가 곧 최종 응답이다.
      return { finalResponse: finalResponse || lastAssistantText, errorText };
    },
  };
}

export const geminiProvider: AgentProvider = {
  id: "gemini",
  label: "Gemini CLI (API 키)",

  async run(task, onEvent, signal): Promise<AgentResult> {
    if (!loggedIn()) {
      return {
        ok: false,
        summary:
          "Gemini API 키가 필요합니다. aistudio.google.com/apikey 에서 발급해 홈 화면의 백엔드 연동에서 저장하세요.",
      };
    }
    const prompt = task.promptOverride ?? buildEdmPrompt(task);
    const mapper = createGeminiLineMapper(onEvent);

    const result = await runJsonlCli({
      bin: GEMINI_BIN,
      args: [
        "-p",
        prompt,
        "-m",
        GEMINI_MODEL,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json",
      ],
      cwd: task.workDir,
      // 헤드리스에서 작업 디렉터리 신뢰 확인을 건너뛴다 (우리가 만든 workDir).
      env: { ...agentEnv(), GEMINI_CLI_TRUST_WORKSPACE: "true" },
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
        : errorText || finalResponse || result.stderrTail || (result.signal ? `프로세스가 ${result.signal} 신호로 종료되었습니다.` : `종료 코드 ${result.code}`),
    };
  },
};
