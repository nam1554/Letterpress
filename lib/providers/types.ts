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
 * One agent backend (Claude Code, Codex, mock, ...).
 * Contract: run the task in task.workDir, stream progress via onEvent,
 * leave downloadable artifacts in task.workDir/output/.
 */
export interface AgentProvider {
  id: string;
  label: string;
  run(
    task: AgentTask,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult>;
}
