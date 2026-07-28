import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { applyCdnTemplate, isValidCdnTemplate } from "@/lib/hosting";
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

  let body: { template?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }
  const template = (body.template ?? "").trim();
  if (!isValidCdnTemplate(template)) {
    return NextResponse.json(
      { error: "https:// 로 시작하는 유효한 URL 템플릿이 필요합니다. 예: https://cdn.example.com/edm/{file}" },
      { status: 400 },
    );
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
    const { html: hosted, replaced } = applyCdnTemplate(html, template);
    if (replaced === 0) continue; // 상대경로 이미지가 없는 파일(셀프컨테인 등)은 건너뜀
    await writeFile(path.join(hostedDir, artifact.rel), hosted);
    created.push({ rel: `hosted/${artifact.rel}`, replaced });
  }

  saveSettings({ cdnTemplate: template });
  return NextResponse.json({ created });
}
