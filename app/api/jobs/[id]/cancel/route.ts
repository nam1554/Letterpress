import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/jobs/runner";
import { getJob } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  const cancelled = cancelJob(id);
  if (!cancelled) {
    return NextResponse.json({ error: "실행 중인 작업이 아닙니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
