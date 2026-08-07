import { NextResponse } from "next/server";
import { requireJob } from "@/lib/api-job";
import { deleteJob, listArtifacts } from "@/lib/jobs/store";
import { listVerifyFiles } from "@/lib/verify";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  return NextResponse.json({
    job: j.job,
    artifacts: await listArtifacts(id),
    verifyFiles: listVerifyFiles(id),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  if (!(await deleteJob(id))) {
    return NextResponse.json(
      { error: "실행 중인 작업은 삭제할 수 없습니다. 먼저 취소하세요." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
