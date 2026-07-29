import { getProvider } from "../providers/registry";
import { getSettings } from "../settings";
import type { AgentEvent } from "../providers/types";
import { checkAcceptance } from "./acceptance";
import { liveControllers } from "./live";
import { appendEvent, updateJob, workDir, type Job } from "./store";

/** Fire-and-forget: runs the job's provider and records lifecycle events. */
export function startJob(job: Job, promptOverride?: string): void {
  const controller = new AbortController();
  liveControllers.set(job.id, controller);

  // A runaway agent must not run forever. Full pipeline is typically 10-25 min.
  const timeoutMinutes = getSettings().jobTimeoutMinutes;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMinutes * 60_000);

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

      const task = {
        jobId: job.id,
        figmaUrl: job.figmaUrl,
        workDir: workDir(job.id),
        promptOverride,
      };
      let result = await provider.run(task, emit, controller.signal);

      // 품질 게이트: 성공은 에이전트 보고가 아니라 산출물 계약으로 판정한다.
      // promptOverride(스모크 테스트)는 eDM 산출물이 없는 게 정상이라 제외.
      let acceptance = promptOverride ? null : await checkAcceptance(job.id);

      // 미충족이면 같은 workDir에서 실패 항목만 명시해 1회 자동 보수.
      if (result.ok && acceptance && !acceptance.ok && !controller.signal.aborted) {
        emit({
          ts: Date.now(),
          type: "status",
          text: `품질 게이트 미충족 — 자동 보수를 1회 실행합니다: ${acceptance.failures.join(" / ")}`,
        });
        result = await provider.run(
          { ...task, repair: { failures: acceptance.failures } },
          emit,
          controller.signal,
        );
        acceptance = await checkAcceptance(job.id);
      }

      for (const w of acceptance?.warnings ?? []) {
        emit({ ts: Date.now(), type: "status", text: `주의: ${w}` });
      }

      const gateOk = acceptance?.ok ?? true;
      const ok = result.ok && gateOk && !timedOut;
      const summary = timedOut
        ? `제한 시간(${timeoutMinutes}분)을 초과해 중단되었습니다.`
        : !result.ok
          ? result.summary
          : !gateOk
            ? `품질 게이트 미충족: ${acceptance!.failures.join(" / ")}`
            : result.summary;
      await updateJob(job.id, {
        status: ok ? "succeeded" : "failed",
        finishedAt: Date.now(),
        summary,
        verify: acceptance?.verify ?? undefined,
      });
      emit({
        ts: Date.now(),
        type: ok ? "done" : "error",
        text: ok ? `완료: ${summary}` : `실패: ${summary}`,
      });
    } catch (err) {
      const message = timedOut
        ? `제한 시간(${timeoutMinutes}분)을 초과해 중단되었습니다.`
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
