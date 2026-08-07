import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { getJob, invalidateJobSize, resolveArtifact, updateJob, workDir } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ file: z.string().min(1), html: z.string().min(1) }),
  z.object({ file: z.string().min(1), restore: z.literal(true) }),
]);

/**
 * PUT /api/jobs/:id/artifact — 뷰어 인라인 편집의 저장/복원.
 * output 최상위 .html만 허용: hosted/ 는 재생성 시 덮이고, images/ 는 대상이 아니다.
 * 첫 저장 때 원본을 work/edit-backup/ 에 백업한다 — output 밖에 두는 이유는
 * listArtifacts가 output을 재귀 순회해 백업이 산출물 목록·zip에 섞이기 때문.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  if (job.status === "queued" || job.status === "running") {
    return NextResponse.json(
      { error: "실행 중인 작업의 산출물은 수정할 수 없습니다." },
      { status: 409 },
    );
  }

  const r = await readBody(req, schema);
  if (!r.ok) return r.res;
  const { file } = r.data;

  // 최상위 .html만 — 구분자 검사는 양쪽 다 (Windows에서 \ 도 경로 구분자).
  if (file.includes("/") || file.includes("\\") || !file.endsWith(".html")) {
    return NextResponse.json(
      { error: "output 최상위의 .html 산출물만 수정할 수 있습니다." },
      { status: 400 },
    );
  }
  const full = resolveArtifact(id, file);
  if (!full) return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });

  const backupFile = path.join(workDir(id), "edit-backup", file);

  if ("restore" in r.data) {
    if (!existsSync(backupFile)) {
      return NextResponse.json({ error: "되돌릴 원본 백업이 없습니다." }, { status: 404 });
    }
    await copyFile(backupFile, full);
    const manualEdits = { ...job.manualEdits };
    delete manualEdits[file];
    await updateJob(id, {
      manualEdits: Object.keys(manualEdits).length > 0 ? manualEdits : undefined,
    });
    invalidateJobSize(id);
    return NextResponse.json({ restored: true });
  }

  if (!existsSync(full)) {
    return NextResponse.json({ error: "존재하지 않는 산출물입니다." }, { status: 404 });
  }
  if (!existsSync(backupFile)) {
    // 백업 실패 시 저장 중단 — 원본 보존이 저장보다 우선한다.
    try {
      await mkdir(path.dirname(backupFile), { recursive: true });
      await copyFile(full, backupFile);
    } catch {
      return NextResponse.json(
        { error: "원본 백업에 실패해 저장을 중단했습니다. 디스크 상태를 확인해 주세요." },
        { status: 500 },
      );
    }
  }
  await writeFile(full, r.data.html);
  await updateJob(id, { manualEdits: { ...job.manualEdits, [file]: Date.now() } });
  invalidateJobSize(id);
  return NextResponse.json({ saved: true });
}
