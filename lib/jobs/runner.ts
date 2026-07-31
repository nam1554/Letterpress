import { getProvider } from "../providers/registry";
import { getSettings } from "../settings";
import type { AgentEvent, AgentTask } from "../providers/types";
import { checkAcceptance } from "./acceptance";
import { liveControllers } from "./live";
import { notifyJobFinished } from "./notify";
import { appendEvent, updateJob, workDir, type Job } from "./store";

export interface StartOptions {
  /** Dev/smoke-test escape hatch — eDM 프롬프트를 통째로 대체. */
  promptOverride?: string;
  /**
   * 실패한 잡을 같은 workDir에서 이어서 실행 — 현재 게이트 미충족 항목을
   * 첫 런의 보수 컨텍스트로 싣는다 (중간 산출물 재사용).
   */
  resume?: boolean;
}

/**
 * Runs the job's provider and records lifecycle events. The running-status
 * transition is persisted BEFORE resolving — an SSE connect right after the
 * HTTP response must not see the old (terminal) state and close early. The
 * provider run itself is fire-and-forget.
 */
export async function startJob(job: Job, opts: StartOptions = {}): Promise<void> {
  const { promptOverride, resume } = opts;
  // 이 시도가 시작된 시각 — 품질 게이트가 이전 실행의 검증 결과를 이번 증거로
  // 인정하지 않도록 하는 기준점.
  const startedAt = Date.now();
  // 설정 읽기 실패는 전역 상태를 만들기 전에 터져야 한다.
  // A runaway agent must not run forever. Full pipeline is typically 10-25 min.
  const timeoutMinutes = getSettings().jobTimeoutMinutes;

  const controller = new AbortController();
  liveControllers.set(job.id, controller);

  let timedOut = false;
  const timer = setTimeout(() => {
    // 이미 사용자가 멈춘 실행을 뒤늦게 "제한 시간 초과"로 덮어쓰지 않는다 —
    // CLI는 분리된 프로세스 그룹이라 죽는 데 시간이 걸릴 수 있다.
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMinutes * 60_000);

  const emit = (e: AgentEvent) => appendEvent(job.id, e);

  try {
    // resume은 실패 잡을 되살리므로 이전 종료 기록을 지운다.
    await updateJob(
      job.id,
      resume
        ? { status: "running", finishedAt: undefined, summary: undefined, verify: undefined }
        : { status: "running" },
    );
  } catch (err) {
    // 시작에 실패했으면 프로세스 전역 상태를 되돌린다. 남겨두면 타이머가 계속
    // 살아 있고, runningJobCount()가 영구히 부풀어 동시 실행 한도가 이후 모든
    // 작업을 거부하며, deleteJob도 이 잡을 영영 지우지 못한다.
    clearTimeout(timer);
    liveControllers.delete(job.id);
    throw err;
  }

  /** 사용자가 직접 멈춘 실행 (제한 시간 초과는 진짜 실패라 제외). */
  const isCancelled = () => !timedOut && controller.signal.aborted;

  void (async () => {
    try {
      const provider = getProvider(job.provider);
      emit({
        ts: Date.now(),
        type: "status",
        text: `${resume ? "이어서 실행" : "작업 시작"} — provider: ${provider.label}`,
      });

      // 부분 수정(edit) 잡은 의도적으로 원본 Figma와 달라지므로 verify PASS를
      // 강제하지 않는다 (산출물 계약 + 검증 실행 여부는 그대로 요구).
      // freshSince: edit은 원본 workDir을 복사해 오고 resume은 같은 workDir을
      // 재사용하므로, 이전 실행의 verify.json을 이번 증거로 인정하지 않는다.
      // signal: 게이트는 산출물을 헤드리스 Chrome으로 렌더한다 — 취소·시간
      // 초과 뒤에도 브라우저를 새로 띄우면 종료 상태가 그만큼 늦게 찍힌다.
      const gateOpts = {
        requireVerifyPass: !job.editOf,
        freshSince: startedAt,
        signal: controller.signal,
      };
      const task: AgentTask = {
        jobId: job.id,
        figmaUrl: job.figmaUrl,
        workDir: workDir(job.id),
        promptOverride,
        edit: job.editOf && job.instruction ? { instruction: job.instruction } : undefined,
      };
      if (resume) {
        const before = await checkAcceptance(job.id, gateOpts);
        if (!before.ok) task.repair = { failures: before.failures };
      }
      let result = await provider.run(task, emit, controller.signal);

      // 품질 게이트: 성공은 에이전트 보고가 아니라 산출물 계약으로 판정한다.
      // promptOverride(스모크 테스트)는 eDM 산출물이 없는 게 정상이라 제외.
      let acceptance = promptOverride ? null : await checkAcceptance(job.id, gateOpts);

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
        acceptance = await checkAcceptance(job.id, gateOpts);
      }

      for (const w of acceptance?.warnings ?? []) {
        emit({ ts: Date.now(), type: "status", text: `주의: ${w}` });
      }

      // 게이트를 돌리지 않은 경우(스모크 테스트)는 acceptance가 null이고 통과로
      // 친다. `gateFailures`가 비어 있지 않다는 것 자체가 acceptance가 있었고
      // 미충족이었다는 뜻이라, non-null 단언 없이도 분기가 성립한다.
      const gateOk = acceptance?.ok ?? true;
      const gateFailures = gateOk ? [] : (acceptance?.failures ?? []);
      const ok = result.ok && gateOk && !timedOut;
      const summary = timedOut
        ? `제한 시간(${timeoutMinutes}분)을 초과해 중단되었습니다.`
        : !result.ok
          ? result.summary
          : !gateOk
            ? `품질 게이트 미충족: ${gateFailures.join(" / ")}`
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
      // 실제 프로바이더는 중단 시 예외가 아니라 {ok:false}로 끝난다 — 취소
      // 판정을 catch에만 두면 여기서 "변환 실패" 알림이 그대로 나간다.
      if (!isCancelled()) {
        notifyJobFinished({ id: job.id, status: ok ? "succeeded" : "failed", title: job.title });
      }
    } catch (err) {
      const cancelled = isCancelled();
      const message = timedOut
        ? `제한 시간(${timeoutMinutes}분)을 초과해 중단되었습니다.`
        : cancelled
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
      // 사용자가 직접 멈춘 잡은 알리지 않는다 — "변환 실패" 알림이 뜨면
      // 무인 실행을 신뢰하라고 넣은 신호가 오히려 오염된다.
      if (!cancelled) notifyJobFinished({ id: job.id, status: "failed", title: job.title });
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
