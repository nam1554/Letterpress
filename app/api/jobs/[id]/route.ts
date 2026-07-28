import { NextResponse } from "next/server";
import { getJob, listArtifacts } from "@/lib/jobs/store";

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
