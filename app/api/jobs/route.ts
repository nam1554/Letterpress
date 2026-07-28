import { NextRequest, NextResponse } from "next/server";
import { canonicalFigmaUrl, parseFigmaUrl } from "@/lib/figma";
import { runningJobCount, startJob } from "@/lib/jobs/runner";
import { createJob, listJobs } from "@/lib/jobs/store";
import { DEFAULT_PROVIDER_ID, getProvider, listProviders } from "@/lib/providers/registry";

// Each job is a 10-25 min CLI agent run (headless Chrome, font subsetting…).
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS ?? 2);

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    jobs: await listJobs(),
    providers: listProviders(),
    defaultProvider: DEFAULT_PROVIDER_ID,
  });
}

export async function POST(req: NextRequest) {
  let body: { figmaUrl?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  const ref = parseFigmaUrl(body.figmaUrl ?? "");
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

  if (runningJobCount() >= MAX_CONCURRENT_JOBS) {
    return NextResponse.json(
      {
        error: `동시에 실행할 수 있는 작업은 ${MAX_CONCURRENT_JOBS}개입니다. 실행 중인 작업이 끝나거나 취소된 뒤 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  const job = await createJob(canonicalFigmaUrl(ref), providerId);
  startJob(job);
  return NextResponse.json({ job }, { status: 201 });
}
