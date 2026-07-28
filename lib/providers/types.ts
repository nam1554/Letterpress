export type AgentEventType = "status" | "log" | "tool" | "error" | "done";

export interface AgentEvent {
  ts: number;
  type: AgentEventType;
  text: string;
}

export interface AgentTask {
  jobId: string;
  /** Validated Figma design URL. */
  figmaUrl: string;
  /** Agent cwd. Artifacts must be written to `${workDir}/output/`. */
  workDir: string;
  /** Dev/smoke-test escape hatch: replaces the built-in eDM prompt entirely. */
  promptOverride?: string;
}

export interface AgentResult {
  ok: boolean;
  summary: string;
}

/**
 * One agent backend (Claude Code, mock, future: Codex/Gemini...).
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
