import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { listProviders } from "@/lib/providers/registry";
import { validateFigmaToken, validateGeminiKey } from "@/lib/setup";

export const dynamic = "force-dynamic";

// 토큰/키는 원문을 응답에 싣지 않는다 — UI는 설정 여부만 알면 된다.
function masked() {
  const s = getSettings();
  return {
    defaultProvider: s.defaultProvider,
    maxConcurrentJobs: s.maxConcurrentJobs,
    jobTimeoutMinutes: s.jobTimeoutMinutes,
    figmaTokenSet: s.figmaToken.length > 0,
    geminiApiKeySet: s.geminiApiKey.length > 0,
    cdnTemplate: s.cdnTemplate,
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
    geminiApiKey?: string;
    cdnTemplate?: string;
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

  // 키/토큰은 저장 전에 실제 API로 검증한다 — 오타를 잡 실패가 아니라 지금 잡는다.
  // 네트워크 문제로 검증 자체가 불가하면 저장은 하되 경고를 돌려준다.
  const warnings: string[] = [];
  if (body.figmaToken?.trim()) {
    const check = await validateFigmaToken(body.figmaToken.trim());
    if (check === "invalid") {
      return NextResponse.json(
        { error: "Figma 토큰이 유효하지 않습니다 (api.figma.com 인증 거부). 다시 발급해 주세요." },
        { status: 400 },
      );
    }
    if (check === "network") warnings.push("네트워크 문제로 Figma 토큰을 검증하지 못했습니다.");
  }
  if (body.geminiApiKey?.trim()) {
    const check = await validateGeminiKey(body.geminiApiKey.trim());
    if (check === "invalid") {
      return NextResponse.json(
        { error: "Gemini API 키가 유효하지 않습니다 (Google API 인증 거부). aistudio.google.com/apikey 에서 확인해 주세요." },
        { status: 400 },
      );
    }
    if (check === "network") warnings.push("네트워크 문제로 Gemini API 키를 검증하지 못했습니다.");
  }

  saveSettings(body);
  return NextResponse.json({ ...masked(), warning: warnings.join(" ") || undefined });
}
