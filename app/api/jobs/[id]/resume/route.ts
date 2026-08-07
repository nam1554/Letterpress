import { NextResponse } from "next/server";
import { liveControllers } from "@/lib/jobs/live";
import { runningJobCount, startJob } from "@/lib/jobs/runner";
import { getJob } from "@/lib/jobs/store";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** 실패한 잡을 같은 workDir에서 이어서 실행 — 중간 산출물을 재사용한다. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  if (job.status !== "failed") {
    return NextResponse.json(
      { error: "실패한 작업만 이어서 실행할 수 있습니다." },
      { status: 409 },
    );
  }
  // job.json은 failed인데 러너가 이미 붙어 있는 찰나(더블클릭 동시 요청) —
  // startJob의 가드가 최종 방어선이지만, 여기서 걸러야 500 대신 정돈된 409가 간다.
  if (liveControllers.has(id)) {
    return NextResponse.json({ error: "이미 실행 중인 작업입니다." }, { status: 409 });
  }

  const maxConcurrent = getSettings().maxConcurrentJobs;
  if (runningJobCount() >= maxConcurrent) {
    return NextResponse.json(
      {
        error: `동시에 실행할 수 있는 작업은 ${maxConcurrent}개입니다. 실행 중인 작업이 끝나거나 취소된 뒤 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  try {
    await startJob(job, { resume: true });
  } catch (err) {
    // startJob의 이중 실행 가드 — 위 검사와 startJob 사이의 찰나에 다른 요청이
    // 먼저 시작한 경우다. 500이 아니라 같은 409로 답한다.
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
  return NextResponse.json({ job: { ...job, status: "running" } });
}
