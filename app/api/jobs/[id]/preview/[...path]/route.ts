import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getJob, resolveArtifact } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

/**
 * Path-based inline preview: /api/jobs/:id/preview/edm_figma.html
 * Relative references inside the HTML (images/...) resolve naturally.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: parts } = await params;
  if (!(await getJob(id))) return new Response("not found", { status: 404 });

  // Next가 이미 퍼센트 디코딩해 넘긴다. 한 번 더 디코딩하면 이름에 '%'가 든
  // 파일이 도달 불가능해지고, '100%.png' 같은 이름은 URIError로 500이 된다.
  const rel = parts.join("/");
  const full = resolveArtifact(id, rel);
  if (!full) return new Response("invalid path", { status: 400 });

  if (!existsSync(full) || !statSync(full).isFile()) {
    return new Response("file not found", { status: 404 });
  }
  const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
  });
}
