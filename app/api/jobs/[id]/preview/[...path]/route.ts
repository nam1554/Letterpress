import { createReadStream } from "node:fs";
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

  const rel = parts.map(decodeURIComponent).join("/");
  const full = resolveArtifact(id, rel);
  if (!full) return new Response("invalid path", { status: 400 });

  const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
  try {
    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new Response(stream, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("file not found", { status: 404 });
  }
}
