import { NextResponse } from "next/server";
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

  const maxConcurrent = getSettings().maxConcurrentJobs;
  if (runningJobCount() >= maxConcurrent) {
    return NextResponse.json(
      {
        error: `동시에 실행할 수 있는 작업은 ${maxConcurrent}개입니다. 실행 중인 작업이 끝나거나 취소된 뒤 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  await startJob(job, { resume: true });
  return NextResponse.json({ job: { ...job, status: "running" } });
}
