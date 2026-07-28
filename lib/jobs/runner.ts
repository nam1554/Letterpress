import { getProvider } from "../providers/registry";
import type { AgentEvent } from "../providers/types";
import { liveControllers } from "./live";
import { appendEvent, updateJob, workDir, type Job } from "./store";

/** Fire-and-forget: runs the job's provider and records lifecycle events. */
export function startJob(job: Job, promptOverride?: string): void {
  const controller = new AbortController();
  liveControllers.set(job.id, controller);

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
      const message = controller.signal.aborted
        ? "사용자가 취소했습니다."
        : err instanceof Error
          ? err.message
          : String(err);
      await updateJob(job.id, {
        status: "failed",
        finishedAt: Date.now(),
        summary: message,
      });
      emit({ ts: Date.now(), type: "error", text: `실패: ${message}` });
    } finally {
      liveControllers.delete(job.id);
    }
  })();
}

export function cancelJob(id: string): boolean {
  const controller = liveControllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
