import { NextResponse } from "next/server";
import { requireJob } from "@/lib/api-job";
import { AlreadyRunningError, ConcurrencyLimitError, startJob } from "@/lib/jobs/runner";

/** 실패한 잡을 같은 workDir에서 이어서 실행 — 중간 산출물을 재사용한다. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  const job = j.job;
  if (job.status !== "failed") {
    return NextResponse.json(
      { error: "실패한 작업만 이어서 실행할 수 있습니다." },
      { status: 409 },
    );
  }
  // 이중 실행·동시 실행 한도는 startJob이 원자적으로 판정한다 — 여기서 미리
  // 검사하면 검사와 시작 사이의 await 동안 다른 요청이 끼어들 수 있다.
  try {
    await startJob(job, { resume: true });
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
  return NextResponse.json({ job: { ...job, status: "running" } });
}
