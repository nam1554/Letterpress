import { NextResponse } from "next/server";
import { deleteJob, getJob, listArtifacts } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ job, artifacts: await listArtifacts(id) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  if (!(await deleteJob(id))) {
    return NextResponse.json(
      { error: "실행 중인 작업은 삭제할 수 없습니다. 먼저 취소하세요." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
