import { getSettings } from "../settings";
import { exitReason, runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";

// agy --output-format stream-json 실측 스키마 (v1.1.9, 2026-07-31 관측).
// 공식 문서는 {type, …} 평면 구조라고 하지만 실제는 {event, <event>:{…}} 중첩이다.
// 관측되지 않은 필드는 optional로 두고, 모르는 event는 무시한다.
export interface AgyLine {
  event?: string;
  conversation_id?: string;
  init?: { cwd?: string; tools?: string[]; permission_mode?: string };
  step_update?: {
    step_index?: number;
    /** "ACTIVE" | "DONE" */
    state?: string;
    /** "user_input" | "unknown" | "tool" | "agent_response" | "checkpoint" */
    step_type?: string;
    tool_name?: string;
    tool_info?: { name?: string; parameters?: unknown; output?: unknown };
    text_delta?: string;
    duration_seconds?: number;
  };
  result?: {
    /** 실측값은 대문자 "SUCCESS". */
    status?: string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
  };
}

/**
 * agy는 자체 태스크 시스템의 알림을 최종 응답에 그대로 섞어 보낸다.
 * 잡 요약에 로그 덩어리가 실리지 않게 걷어낸다.
 *
 * 2026-07-31 리뷰 수정: 최초 브리프는 run2 스트림 한 건만 보고 `<SYSTEM_MESSAGE>`와
 * `production mode active`만 지시했다. run3(재생 검증에 쓴 실측 파일)에는 그 둘이
 * 하나도 없고 대신 `<notification>…</notification>`(내부 task id + 절대 로그 경로 포함,
 * run2/run3 양쪽 다 등장 — 셋 중 가장 흔함)가 그대로 남아 있었다. 세 패턴 다 걷어낸다.
 */
export function stripAgySystemNoise(text: string): string {
  return text
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/g, "")
    .replace(/<notification>[\s\S]*?<\/notification>/g, "")
    .replace(/^\s*\.\.\. production mode active \.\.\.\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Stateful mapper: agent_response의 text_delta를 완성된 줄로 모아 흘리고,
 * 최종 응답과 첫 에러를 붙잡는다. 순수 로직이라 유닛 테스트로 덮는다.
 */
export function createAgyLineMapper(onEvent: (e: AgentEvent) => void) {
  let buffer = "";
  let finalResponse = "";
  let errorText = "";

  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    if (text) onEvent({ ts: Date.now(), type: "log", text });
  };

  return {
    handle(line: AgyLine) {
      if (line.event === "init") {
        onEvent({ ts: Date.now(), type: "status", text: "Antigravity 세션 시작" });
        return;
      }
      if (line.event === "step_update") {
        const s = line.step_update;
        if (!s) return;
        if (s.step_type === "agent_response" && typeof s.text_delta === "string") {
          buffer += s.text_delta;
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const p of parts) {
            if (p.trim()) onEvent({ ts: Date.now(), type: "log", text: p.trim() });
          }
          return;
        }
        // 툴은 완료 시점에만 남긴다 — ACTIVE까지 찍으면 로그가 두 배가 된다.
        if (s.step_type === "tool" && s.state === "DONE" && s.tool_name) {
          flush();
          onEvent({ ts: Date.now(), type: "tool", text: s.tool_name });
        }
        return;
      }
      if (line.event === "result") {
        flush();
        const r = line.result ?? {};
        // 실측: 성공은 대문자 "SUCCESS". 그 외(다른 값 또는 status 필드 자체가
        // 없는 경우)는 실패로 본다 — 리뷰 수정: status 부재를 성공으로 흘리면
        // 스키마가 예상과 어긋난 응답을 조용히 통과시킨다. 실측에선 항상 있었지만
        // 방어 비용이 싸다.
        if (r.status !== "SUCCESS") {
          errorText = stripAgySystemNoise(r.response ?? "").trim() || r.status || "status 없음";
          onEvent({ ts: Date.now(), type: "error", text: errorText });
          return;
        }
        finalResponse = stripAgySystemNoise(r.response ?? "").trim() || finalResponse;
      }
    },
    finish() {
      flush();
      return { finalResponse, errorText };
    },
  };
}

const AGY_BIN = process.env.ANTIGRAVITY_BIN ?? "agy";

/**
 * agy print 모드의 기본 타임아웃은 5분(`5m0s`)인데 eDM 파이프라인은 실측 3~4분
 * (느린 디자인은 더)이라 여유가 없다. 잡 타임아웃과 같은 값을 쓴다.
 * 형식은 Go duration — 분 단위 `<n>m`이 유효하다.
 */
function printTimeoutArg(): string {
  return `${getSettings().jobTimeoutMinutes}m`;
}

export const antigravityProvider: AgentProvider = {
  id: "antigravity",
  label: "Antigravity CLI (Google 구독)",
  verification: "verified",
  verificationNote: "2026-07-31 실측 PASS 93.05%, 3분 (Figma 토큰 필요)",

  async run(task, onEvent, signal): Promise<AgentResult> {
    const prompt = task.promptOverride ?? buildEdmPrompt(task);
    const mapper = createAgyLineMapper(onEvent);

    const result = await runJsonlCli({
      bin: AGY_BIN,
      args: [
        // agy는 --add-dir 없이는 서브에이전트를 자기 스크래치에서 돌린다.
        // 그러면 산출물이 workDir 밖에 생겨 게이트가 무조건 실패한다 (실측).
        "--add-dir",
        task.workDir,
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        // 잡 작업 디렉터리는 우리가 만든 것이고 앱은 로컬 전용이다.
        "--dangerously-skip-permissions",
        "--print-timeout",
        printTimeoutArg(),
      ],
      cwd: task.workDir,
      env: agentEnv(),
      signal,
      onJson: (obj) => mapper.handle(obj as AgyLine),
      onText: (raw) => onEvent({ ts: Date.now(), type: "log", text: raw }),
    });

    const { finalResponse, errorText } = mapper.finish();

    if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
    if (result.kind === "spawn-error") {
      const message = result.error?.message ?? "unknown";
      onEvent({ ts: Date.now(), type: "error", text: `agy 실행 실패: ${message}` });
      return {
        ok: false,
        summary: `Antigravity CLI를 실행할 수 없습니다: ${message} (antigravity.google.com/download 설치 후 \`agy\`를 한 번 실행해 로그인하세요)`,
      };
    }

    // 실측: 프롬프트가 FATAL을 찍어도 agy의 status는 SUCCESS다.
    // 다른 프로바이더와 같이 최종 응답의 접두어로 판정한다.
    const fatal = finalResponse.trim().startsWith("FATAL:");
    const ok = result.code === 0 && !fatal && !errorText;
    return {
      ok,
      summary: ok
        ? finalResponse || "완료"
        : errorText || finalResponse || result.stderrTail || exitReason(result),
    };
  },
};
