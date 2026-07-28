import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { listProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

// The Figma token never leaves the server in full — the UI only needs to know
// whether one is set.
function masked() {
  const s = getSettings();
  return {
    defaultProvider: s.defaultProvider,
    maxConcurrentJobs: s.maxConcurrentJobs,
    jobTimeoutMinutes: s.jobTimeoutMinutes,
    figmaTokenSet: s.figmaToken.length > 0,
    providers: listProviders(),
  };
}

export async function GET() {
  return NextResponse.json(masked());
}

export async function PUT(req: NextRequest) {
  let body: {
    defaultProvider?: string;
    maxConcurrentJobs?: number;
    jobTimeoutMinutes?: number;
    figmaToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  if (
    body.defaultProvider !== undefined &&
    !listProviders().some((p) => p.id === body.defaultProvider)
  ) {
    return NextResponse.json({ error: "알 수 없는 백엔드입니다." }, { status: 400 });
  }

  saveSettings(body);
  return NextResponse.json(masked());
}
