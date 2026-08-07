import { NextResponse } from "next/server";
import { requireJob } from "@/lib/api-job";
import { cancelJob } from "@/lib/jobs/runner";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  const cancelled = cancelJob(id);
  if (!cancelled) {
    return NextResponse.json({ error: "실행 중인 작업이 아닙니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
