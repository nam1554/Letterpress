import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { runningJobCount, startJob } from "@/lib/jobs/runner";
import { createEditJob, getJob, listArtifacts } from "@/lib/jobs/store";
import { getSettings } from "@/lib/settings";

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

  const maxConcurrent = getSettings().maxConcurrentJobs;
  if (runningJobCount() >= maxConcurrent) {
    return NextResponse.json(
      {
        error: `동시에 실행할 수 있는 작업은 ${maxConcurrent}개입니다. 실행 중인 작업이 끝나거나 취소된 뒤 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  const job = await createEditJob(source, r.data.instruction);
  await startJob(job);
  return NextResponse.json({ job }, { status: 201 });
}
