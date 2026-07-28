import { getProvider } from "../providers/registry";
import type { AgentEvent } from "../providers/types";
import { liveControllers } from "./live";
import { appendEvent, updateJob, workDir, type Job } from "./store";

// A runaway agent must not run forever. Full pipeline is typically 10-25 min.
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 45 * 60_000);

/** Fire-and-forget: runs the job's provider and records lifecycle events. */
export function startJob(job: Job, promptOverride?: string): void {
  const controller = new AbortController();
  liveControllers.set(job.id, controller);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, JOB_TIMEOUT_MS);

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

      const summary = timedOut
        ? `제한 시간(${Math.round(JOB_TIMEOUT_MS / 60_000)}분)을 초과해 중단되었습니다.`
        : result.summary;
      const ok = result.ok && !timedOut;
      await updateJob(job.id, {
        status: ok ? "succeeded" : "failed",
        finishedAt: Date.now(),
        summary,
      });
      emit({
        ts: Date.now(),
        type: ok ? "done" : "error",
        text: ok ? `완료: ${summary}` : `실패: ${summary}`,
      });
    } catch (err) {
      const message = timedOut
        ? `제한 시간(${Math.round(JOB_TIMEOUT_MS / 60_000)}분)을 초과해 중단되었습니다.`
        : controller.signal.aborted
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
      clearTimeout(timer);
      liveControllers.delete(job.id);
    }
  })();
}

/** Number of jobs currently executing in this process. */
export function runningJobCount(): number {
  return liveControllers.size;
}

export function cancelJob(id: string): boolean {
  const controller = liveControllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
