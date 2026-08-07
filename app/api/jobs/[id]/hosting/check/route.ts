import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireJob } from "@/lib/api-job";
import { checkHostedUrls, hostedEntries, type ProbeFetcher } from "@/lib/hosting-check";
import { outputDir } from "@/lib/jobs/store";

const MANIFEST = z.object({
  template: z.string(),
  folder: z.string(),
  files: z.array(z.string()),
});

const realFetcher: ProbeFetcher = (url, method, signal) =>
  fetch(url, { method, signal, redirect: "follow" }).then((r) => {
    // 상태만 보면 된다 — GET 폴백에서 IIIF full/max 렌더 본문을 끝까지 받지
    // 않도록 즉시 끊는다. (테스트 스텁이 body 없이 {status}만 돌려줘도 되는
    // 이유이기도 하다 — 여기서 body를 더 읽게 되면 스텁에도 body가 필요하다.)
    void r.body?.cancel().catch(() => {});
    return { status: r.status };
  });

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
  const j = await requireJob(id);
  if (!j.ok) return j.res;

  const hostedDir = path.join(outputDir(id), "hosted");
  let manifest: z.infer<typeof MANIFEST>;
  try {
    const raw = await readFile(path.join(hostedDir, "manifest.json"), "utf8");
    manifest = MANIFEST.parse(JSON.parse(raw));
  } catch {
    // 매핑 기록 이전 버전에서 만든 교체본이 있을 수 있다. 그때 "교체본을
    // 먼저 생성하세요"라고만 하면, 폴더명이 오늘 날짜로 기본 제안되는 탓에
    // 멀쩡히 업로드된 캠페인 폴더 대신 빈 폴더를 가리키는 교체본으로
    // 덮어쓰도록 유도하게 된다 — 함정을 이름 붙여 알려준다.
    const legacyHosted =
      existsSync(hostedDir) &&
      (await readdir(hostedDir).catch(() => [] as string[])).some((f) => f.endsWith(".html"));
    return NextResponse.json(
      {
        error: legacyHosted
          ? "이전 버전에서 만든 교체본이라 검사 정보가 없습니다 — 당시 캠페인 폴더명 그대로 '교체본 생성'을 다시 실행하면 검사할 수 있습니다."
          : "교체본을 먼저 생성하세요 — 검사할 CDN 매핑이 없습니다.",
      },
      { status: 400 },
    );
  }

  const summary = await checkHostedUrls(
    hostedEntries(manifest.files, manifest.template, manifest.folder),
    realFetcher,
  );
  return NextResponse.json(summary);
}
