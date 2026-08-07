import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { requireJob } from "@/lib/api-job";
import { workDir } from "@/lib/jobs/store";
import { isVerifyFile } from "@/lib/verify";

/** GET /api/jobs/:id/verify/:name — 픽셀 검증 이미지 서빙 (allowlist). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;
  if (!isVerifyFile(name)) return new Response("invalid file", { status: 400 });

  const full = path.join(workDir(id), name);
  if (!existsSync(full) || !statSync(full).isFile()) {
    return new Response("file not found", { status: 404 });
  }
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    headers: { "Content-Type": "image/png" },
  });
}
