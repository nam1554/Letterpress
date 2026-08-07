import { execa } from "execa";
import type { AgentEvent, AgentResult } from "./types";

/**
 * Shared subprocess runner for JSONL-streaming agent CLIs (claude/codex).
 *
 * execa가 손으로 짜기 까다로운 부분을 대신 맡는다:
 * - 줄 단위 스트리밍(`lines: true`)과 마지막 개행 없는 줄
 * - 취소 시 **자손 프로세스까지** 종료(`killDescendants`) — CLI들은 래퍼(shim)가
 *   실제 바이너리를 다시 spawn하므로 직계 자식만 죽이면 손자가 고아로 남아
 *   토큰을 계속 소모한다. 유닉스는 프로세스 그룹, 윈도우는 taskkill.
 * - 윈도우에서 `codex.cmd` 같은 셸 shim 실행 (Node는 CVE-2024-27980 이후
 *   `.cmd`를 shell 없이 spawn하면 예외를 던진다)
 * 여기 남는 것은 "무엇을 결과로 볼 것인가"뿐이다.
 */
export interface JsonlCliResult {
  kind: "closed" | "aborted" | "spawn-error";
  /** 신호로 종료된 경우 그 이름 (예: SIGKILL) — 진단에 필요하다. */
  signal?: string;
  /** Exit code (kind === "closed"). */
  code?: number | null;
  /** Spawn failure (kind === "spawn-error"). */
  error?: Error;
  /** Last ~2KB of stderr — usually the actionable CLI error. */
  stderrTail: string;
}

/**
 * CLI가 왜 끝났는지를 사람이 읽을 한 줄로. 프로바이더들이 파싱한 텍스트가
 * 하나도 없을 때 쓰는 최후의 요약이다.
 */
export function exitReason(result: JsonlCliResult): string {
  return result.signal
    ? `프로세스가 ${result.signal} 신호로 종료되었습니다.`
    : `종료 코드 ${result.code}`;
}

/**
 * 스트림이 끝난 뒤 세 프로바이더가 똑같이 밟아야 하는 종결 판정 —
 * 취소·spawn 실패 문구, FATAL 접두어 검사, 요약 폴백 체인
 * (errorText → finalText → stderrTail → exitReason). 프로바이더마다 복사해
 * 두면 문구·동작을 고칠 때 한 곳만 빠져도 그 백엔드만 다른 말을 하게 된다.
 */
export function concludeJsonlRun(
  result: JsonlCliResult,
  opts: {
    /** 이벤트 접두어에 쓰는 실행 파일 이름 (예: "claude", "agy"). */
    bin: string;
    /** 요약에 쓰는 CLI 표시 이름 (예: "Antigravity"). 생략 시 bin. */
    title?: string;
    /** spawn 실패 요약 꼬리 — 설치·로그인 안내 (예: "(npm i -g …)"). */
    installHint?: string;
    /** 스트림에서 모은 최종 응답 — "FATAL:" 접두어면 실패. */
    finalText: string;
    /** 스트림에서 잡은 첫 에러 — 있으면 실패, 요약 1순위. */
    errorText?: string;
    /** 성공 이벤트를 명시적으로 요구하는 CLI의 관측 결과 (기본 true). */
    sawSuccess?: boolean;
    onEvent: (e: AgentEvent) => void;
  },
): AgentResult {
  if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
  if (result.kind === "spawn-error") {
    const message = result.error?.message ?? "unknown";
    opts.onEvent({ ts: Date.now(), type: "error", text: `${opts.bin} 실행 실패: ${message}` });
    return {
      ok: false,
      summary:
        `${opts.title ?? opts.bin} CLI를 실행할 수 없습니다: ${message}` +
        (opts.installHint ? ` ${opts.installHint}` : ""),
    };
  }
  const fatal = opts.finalText.trim().startsWith("FATAL:");
  const ok = result.code === 0 && (opts.sawSuccess ?? true) && !fatal && !opts.errorText;
  return {
    ok,
    summary: ok
      ? opts.finalText || "완료"
      : opts.errorText || opts.finalText || result.stderrTail || exitReason(result),
  };
}

export async function runJsonlCli(opts: {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Called per parsed JSON line, in stream order. */
  onJson: (obj: unknown) => void;
  /** Called for a non-empty stdout line that is not valid JSON. */
  onText: (raw: string) => void;
}): Promise<JsonlCliResult> {
  let stderrTail = "";
  const subprocess = execa(opts.bin, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    extendEnv: false,
    stdin: "ignore",
    lines: true,
    buffer: false,
    reject: false,
    cancelSignal: opts.signal,
    killDescendants: true,
    // 취소 신호를 무시하는 CLI가 있어도 걸려 있지 않게 한다.
    forceKillAfterDelay: 5_000,
  });

  const readStderr = (async () => {
    for await (const line of subprocess.iterable({ from: "stderr" })) {
      stderrTail = `${stderrTail}${line}\n`.slice(-2000);
    }
  })().catch(() => {});

  try {
    for await (const line of subprocess) {
      if (!line.trim()) continue;
      try {
        opts.onJson(JSON.parse(line));
      } catch {
        opts.onText(line);
      }
    }
  } catch {
    /* 스트림 오류는 아래 result에서 판정한다 */
  }

  const result = await subprocess.catch((error: Error) => error);
  await readStderr;

  if (opts.signal.aborted) return { kind: "aborted", stderrTail };
  // reject:false면 실패한 실행도 "결과"로 돌아온다(ExecaError). 실행조차 못 한
  // 경우(ENOENT 등)와 구분해야 한다 — 신호로 죽은 실행은 exitCode가 undefined
  // 지만 분명히 "실행은 됐다". 이것을 spawn 오류로 분류하면 프로바이더가
  // stderr 꼬리를 버리고 "CLI를 실행할 수 없습니다"라고 말해, 사용자가 멀쩡한
  // CLI를 재설치하러 간다 (OOM으로 죽은 경우 등).
  const { exitCode, isTerminated, signal } = result as {
    exitCode?: number;
    isTerminated?: boolean;
    signal?: string;
  };
  if (typeof exitCode === "number") return { kind: "closed", code: exitCode, stderrTail };
  // 신호로 죽었어도 "실행은 됐다" — 다만 어떤 신호였는지는 남겨야 사용자가
  // "종료 코드 null"만 보고 영문을 모르는 일이 없다.
  if (isTerminated) return { kind: "closed", code: null, signal, stderrTail };
  if (result instanceof Error) return { kind: "spawn-error", error: result, stderrTail };
  return { kind: "closed", code: null, stderrTail };
}
