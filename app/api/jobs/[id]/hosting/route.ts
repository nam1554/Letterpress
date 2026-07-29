import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
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

  let body: { template?: string; folder?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }
  const template = (body.template ?? "").trim();
  const folder = (body.folder ?? "").trim();
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
  for (const artifact of htmlArtifacts) {
    const html = await readFile(path.join(base, artifact.rel), "utf8");
    const { html: hosted, replaced } = applyCdnTemplate(html, template, folder);
    if (replaced === 0) continue; // 상대경로 이미지가 없는 파일(셀프컨테인 등)은 건너뜀
    await writeFile(path.join(hostedDir, artifact.rel), hosted);
    created.push({ rel: `hosted/${artifact.rel}`, replaced });
  }

  saveSettings({ cdnTemplate: template });
  return NextResponse.json({ created });
}
