import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { ConcurrencyLimitError, startJob } from "@/lib/jobs/runner";
import { createEditJob, deleteJob, getJob, listArtifacts } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const editBody = z.object({
  instruction: z
    .string({ error: "수정 지시문(instruction)이 필요합니다." })
    .trim()
    .min(4, "수정 지시문을 조금 더 구체적으로 적어주세요.")
    .max(2000, "수정 지시문은 2000자 이하여야 합니다."),
});

/**
 * 부분 수정 — 원본 잡의 work/를 복사한 새 잡을 만들어, 지시된 문구/이미지
 * 변경만 적용하는 edit 런을 시작한다. 원본 잡은 그대로 보존된다.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await readBody(req, editBody);
  if (!r.ok) return r.res;

  const source = await getJob(id);
  if (!source) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  if (source.status === "running" || source.status === "queued") {
    return NextResponse.json(
      { error: "실행 중인 작업은 수정할 수 없습니다. 완료를 기다리세요." },
      { status: 409 },
    );
  }
  if (!(await listArtifacts(id)).some((a) => a.rel.endsWith(".html"))) {
    return NextResponse.json(
      { error: "수정할 HTML 산출물이 없는 작업입니다. 먼저 변환을 완료하세요." },
      { status: 409 },
    );
  }

  // 동시 실행 한도는 startJob이 원자적으로 판정한다 (POST /api/jobs와 동일).
  const job = await createEditJob(source, r.data.instruction);
  try {
    await startJob(job);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      // 시작하지 못한 복사본 잡을 남기면 목록에 유령 queued가 쌓인다.
      await deleteJob(job.id);
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
  return NextResponse.json({ job }, { status: 201 });
}
