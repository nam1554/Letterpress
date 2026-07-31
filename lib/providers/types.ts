export type AgentEventType = "status" | "log" | "tool" | "error" | "done";

export interface AgentEvent {
  ts: number;
  type: AgentEventType;
  text: string;
  /** 잡 내 단조 증가 시퀀스 — 스토어가 기록 시 부여 (SSE 중복 제거용). */
  seq?: number;
}

export interface AgentTask {
  jobId: string;
  /** Validated Figma design URL. */
  figmaUrl: string;
  /** Agent cwd. Artifacts must be written to `${workDir}/output/`. */
  workDir: string;
  /** Dev/smoke-test escape hatch: replaces the built-in eDM prompt entirely. */
  promptOverride?: string;
  /**
   * 품질 게이트 미충족으로 재실행되는 보수 런 — 이전 시도의 실패 항목.
   * buildEdmPrompt가 프롬프트에 부록으로 싣는다 (providers는 신경 쓸 필요 없음).
   */
  repair?: { failures: string[] };
  /**
   * 부분 수정 런 — 이미 빌드된 eDM이 workDir에 있고, 지시된 변경만 적용한다.
   * buildEdmPrompt가 edit 전용 프롬프트로 분기한다.
   */
  edit?: { instruction: string };
}

export interface AgentResult {
  ok: boolean;
  summary: string;
}

/**
 * 실전 잡 완주 기록. 코드 완성도가 아니라 측정 결과다.
 * - verified   : 실제 Figma 잡을 끝까지 돌려 게이트 PASS를 확인함
 * - unverified : 코드는 있으나 완주 기록 없음 (선택 시 UI가 경고)
 * - sample     : mock 전용
 */
export type ProviderVerification = "verified" | "unverified" | "sample";

/**
 * One agent backend (Claude Code, Codex, mock, ...).
 * Contract: run the task in task.workDir, stream progress via onEvent,
 * leave downloadable artifacts in task.workDir/output/.
 */
export interface AgentProvider {
  id: string;
  label: string;
  /** 측정으로만 올라간다. 실전 PASS 확인 전에는 "verified"로 쓰지 않는다. */
  verification: ProviderVerification;
  /** 근거 한 줄. 예: "2026-07-30 실측 PASS 98.12%, 15분" */
  verificationNote: string;
  run(
    task: AgentTask,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult>;
}
