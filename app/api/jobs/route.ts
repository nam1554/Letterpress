import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { canonicalFigmaUrl, parseFigmaUrl } from "@/lib/figma";
import { runningJobCount, startJob } from "@/lib/jobs/runner";
import { createJob, deleteJob, listJobs } from "@/lib/jobs/store";
import { defaultProviderId, getProvider, listProviders } from "@/lib/providers/registry";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    jobs: await listJobs(),
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

  // Each job is a 10-25 min CLI agent run (headless Chrome, font subsetting…).
  const maxConcurrent = getSettings().maxConcurrentJobs;
  if (runningJobCount() >= maxConcurrent) {
    return NextResponse.json(
      {
        error: `동시에 실행할 수 있는 작업은 ${maxConcurrent}개입니다. 실행 중인 작업이 끝나거나 취소된 뒤 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  const job = await createJob(canonicalFigmaUrl(ref), providerId, ref.title);
  startJob(job);
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
