import { getProvider } from "../providers/registry";
import type { AgentEvent } from "../providers/types";
import { appendEvent, updateJob, workDir, type Job } from "./store";

interface RunnerGlobal {
  controllers: Map<string, AbortController>;
}
const g = globalThis as unknown as { __runnerGlobal?: RunnerGlobal };
const live: RunnerGlobal = (g.__runnerGlobal ??= { controllers: new Map() });

/** Fire-and-forget: runs the job's provider and records lifecycle events. */
export function startJob(job: Job, promptOverride?: string): void {
  const controller = new AbortController();
  live.controllers.set(job.id, controller);

  const emit = (e: AgentEvent) => appendEvent(job.id, e);

  void (async () => {
    try {
      const provider = getProvider(job.provider);
      await updateJob(job.id, { status: "running" });
      emit({
        ts: Date.now(),
        type: "status",
        text: `작업 시작 — provider: ${provider.label}`,
      });

      const result = await provider.run(
        {
          jobId: job.id,
          figmaUrl: job.figmaUrl,
          workDir: workDir(job.id),
          promptOverride,
        },
        emit,
        controller.signal,
      );

      await updateJob(job.id, {
        status: result.ok ? "succeeded" : "failed",
        finishedAt: Date.now(),
        summary: result.summary,
      });
      emit({
        ts: Date.now(),
        type: result.ok ? "done" : "error",
        text: result.ok ? `완료: ${result.summary}` : `실패: ${result.summary}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJob(job.id, {
        status: "failed",
        finishedAt: Date.now(),
        summary: message,
      });
      emit({ ts: Date.now(), type: "error", text: `실패: ${message}` });
    } finally {
      live.controllers.delete(job.id);
    }
  })();
}

export function cancelJob(id: string): boolean {
  const controller = live.controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
