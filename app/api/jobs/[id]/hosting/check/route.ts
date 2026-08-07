import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkHostedUrls, hostedEntries, type ProbeFetcher } from "@/lib/hosting-check";
import { getJob, outputDir } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const MANIFEST = z.object({
  template: z.string(),
  folder: z.string(),
  files: z.array(z.string()),
});

const realFetcher: ProbeFetcher = (url, method, signal) =>
  fetch(url, { method, signal, redirect: "follow" }).then((r) => ({ status: r.status }));

/**
 * GET /api/jobs/:id/hosting/check
 * hosted/ 생성 시 남긴 manifest의 파일↔URL 매핑으로, 각 CDN URL이 실제로
 * 살아 있는지 서버에서 확인한다 (업로드는 수동 — 검증만 자동화한다는 설계).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  let manifest: z.infer<typeof MANIFEST>;
  try {
    const raw = await readFile(path.join(outputDir(id), "hosted", "manifest.json"), "utf8");
    manifest = MANIFEST.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      { error: "교체본을 먼저 생성하세요 — 검사할 CDN 매핑이 없습니다." },
      { status: 400 },
    );
  }

  const summary = await checkHostedUrls(
    hostedEntries(manifest.files, manifest.template, manifest.folder),
    realFetcher,
  );
  return NextResponse.json(summary);
}
