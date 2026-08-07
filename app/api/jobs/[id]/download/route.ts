import { createReadStream, existsSync, statSync } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { NextRequest } from "next/server";
import { requireJob } from "@/lib/api-job";
import { listArtifacts, outputDir, resolveArtifact } from "@/lib/jobs/store";


const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".css": "text/css",
};

/**
 * GET /api/jobs/:id/download          → zip of everything in output/
 * GET /api/jobs/:id/download?file=rel → single artifact (inline for preview with &inline=1)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;

  const file = req.nextUrl.searchParams.get("file");
  if (file) {
    const full = resolveArtifact(id, file);
    if (!full) return new Response("invalid path", { status: 400 });
    // createReadStream fails asynchronously — check up front to return a real 404.
    if (!existsSync(full) || !statSync(full).isFile()) {
      return new Response("file not found", { status: 404 });
    }
    const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const name = file.split("/").pop() ?? "file";
    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        // RFC 5987 filename* — filename="…"에 percent-encoding을 넣으면
        // 브라우저가 디코딩하지 않아 한글 이름이 %ED%95%9C… 그대로 저장된다.
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  }

  const artifacts = await listArtifacts(id);
  if (artifacts.length === 0) return new Response("no artifacts yet", { status: 404 });

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const pass = new PassThrough();
  // Without an error listener an archiver failure would crash the process.
  archive.on("error", (err) => pass.destroy(err));
  archive.pipe(pass);
  archive.directory(outputDir(id), false);
  void archive.finalize();

  return new Response(Readable.toWeb(pass) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="edm-${id}.zip"`,
    },
  });
}
