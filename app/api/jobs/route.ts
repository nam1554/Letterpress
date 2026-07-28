import { NextRequest, NextResponse } from "next/server";
import { parseFigmaUrl } from "@/lib/figma";
import { startJob } from "@/lib/jobs/runner";
import { createJob, listJobs } from "@/lib/jobs/store";
import { DEFAULT_PROVIDER_ID, getProvider, listProviders } from "@/lib/providers/registry";

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

  const job = await createJob(ref.url, providerId);
  startJob(job);
  return NextResponse.json({ job }, { status: 201 });
}
