import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import {
  applyCdnTemplate,
  isValidCdnFolder,
  isValidCdnTemplate,
  templateNeedsFolder,
} from "@/lib/hosting";
import { getJob, listArtifacts, outputDir } from "@/lib/jobs/store";
import { saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/hosting {template}
 * 루트의 각 HTML 산출물에서 상대경로 이미지를 CDN URL로 치환한 교체본을
 * output/hosted/ 에 생성한다. 템플릿은 설정에 저장해 팀에서 재사용.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  const r = await readBody(
    req,
    z.object({ template: z.string().optional(), folder: z.string().optional() }),
  );
  if (!r.ok) return r.res;
  const template = (r.data.template ?? "").trim();
  const folder = (r.data.folder ?? "").trim();
  if (!isValidCdnTemplate(template)) {
    return NextResponse.json(
      { error: "https:// 로 시작하는 유효한 URL 템플릿이 필요합니다. 예: https://cdn.example.com/{folder}/{file}" },
      { status: 400 },
    );
  }
  if (templateNeedsFolder(template)) {
    if (!folder) {
      return NextResponse.json(
        { error: "템플릿에 {folder}가 있습니다 — 캠페인 폴더명을 입력하세요 (예: aisurfer_edm_20260729)." },
        { status: 400 },
      );
    }
    if (!isValidCdnFolder(folder)) {
      return NextResponse.json(
        { error: "폴더명은 영문·숫자·._- 만 사용할 수 있습니다 (공백·한글·슬래시 불가)." },
        { status: 400 },
      );
    }
  }

  const htmlArtifacts = (await listArtifacts(id)).filter(
    (a) => a.rel.endsWith(".html") && !a.rel.includes("/"),
  );
  if (htmlArtifacts.length === 0) {
    return NextResponse.json({ error: "치환할 HTML 산출물이 없습니다." }, { status: 404 });
  }

  const base = outputDir(id);
  const hostedDir = path.join(base, "hosted");
  await mkdir(hostedDir, { recursive: true });

  const created: Array<{ rel: string; replaced: number }> = [];
  const allFiles = new Set<string>();
  for (const artifact of htmlArtifacts) {
    const html = await readFile(path.join(base, artifact.rel), "utf8");
    const { html: hosted, replaced, files } = applyCdnTemplate(html, template, folder);
    if (replaced === 0) continue; // 상대경로 이미지가 없는 파일(셀프컨테인 등)은 건너뜀
    for (const f of files) allFiles.add(f);
    await writeFile(path.join(hostedDir, artifact.rel), hosted);
    created.push({ rel: `hosted/${artifact.rel}`, replaced });
  }

  // '__'는 사용자 CDN(IIIF)에서 폴더 구분자 — 파일명에 섞여 있으면 의도치 않은
  // 하위 폴더로 해석될 수 있어 경고한다 (템플릿이 '__' 규칙을 쓸 때만).
  const doubleUnderscore = template.includes("__")
    ? [...allFiles].filter((f) => f.includes("__"))
    : [];

  saveSettings({ cdnTemplate: template });
  return NextResponse.json({
    created,
    warning:
      doubleUnderscore.length > 0
        ? `파일명에 '__'가 포함돼 CDN 폴더 구분자와 충돌할 수 있습니다: ${doubleUnderscore.join(", ")}`
        : undefined,
  });
}
