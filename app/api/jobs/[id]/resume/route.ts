import { NextResponse } from "next/server";
import { AlreadyRunningError, ConcurrencyLimitError, startJob } from "@/lib/jobs/runner";
import { getJob } from "@/lib/jobs/store";

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
