import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { canonicalFigmaUrl, parseFigmaUrl } from "@/lib/figma";
import { ConcurrencyLimitError, startJob } from "@/lib/jobs/runner";
import { createJob, deleteJob, jobDirSize, listJobs } from "@/lib/jobs/store";
import { defaultProviderId, getProvider, listProviders } from "@/lib/providers/registry";

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({
    jobs: await Promise.all(jobs.map(async (j) => ({ ...j, diskBytes: await jobDirSize(j) }))),
    providers: listProviders(),
    defaultProvider: defaultProviderId(),
  });
}

const createJobBody = z.object({
  figmaUrl: z.string({ error: "figmaUrl이 필요합니다." }),
  provider: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const r = await readBody(req, createJobBody);
  if (!r.ok) return r.res;
  const body = r.data;

  const ref = parseFigmaUrl(body.figmaUrl);
  if (!ref) {
    return NextResponse.json(
      { error: "유효한 Figma 디자인 URL이 아닙니다. (figma.com/design/... 형식)" },
      { status: 400 },
    );
  }

  let providerId: string;
  try {
    providerId = getProvider(body.provider).id;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // 동시 실행 한도는 startJob이 원자적으로 판정한다 — 라우트에서 검사하면
  // 검사와 시작 사이의 await 동안 동시 요청이 한도를 넘는다.
  const job = await createJob(canonicalFigmaUrl(ref), providerId, ref.title);
  try {
    await startJob(job);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      // 시작하지 못한 잡을 남기면 목록에 유령 queued가 쌓인다.
      await deleteJob(job.id);
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
  return NextResponse.json({ job }, { status: 201 });
}

/** 히스토리 일괄 정리 — 실행 중이 아닌 잡을 모두 삭제한다. */
export async function DELETE() {
  const jobs = await listJobs();
  let deleted = 0;
  for (const job of jobs) {
    if (job.status === "running" || job.status === "queued") continue;
    if (await deleteJob(job.id)) deleted += 1;
  }
  return NextResponse.json({ deleted });
}
