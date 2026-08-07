import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireJob } from "@/lib/api-job";
import { checkEmailHtml } from "@/lib/email-check";
import { resolveArtifact } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id/check?file=rel — HTML 산출물의 발송 전 정적 검사. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const full = file.endsWith(".html") ? resolveArtifact(id, file) : null;
  if (!full) return NextResponse.json({ error: "유효한 HTML 산출물이 아닙니다." }, { status: 400 });

  try {
    const html = await readFile(full, "utf8");
    return NextResponse.json({ checks: checkEmailHtml(html) });
  } catch {
    return NextResponse.json({ error: "파일을 읽을 수 없습니다." }, { status: 404 });
  }
}
