import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { getSettings, saveSettings } from "@/lib/settings";
import { listProviders } from "@/lib/providers/registry";
import { validateFigmaToken } from "@/lib/setup";

export const dynamic = "force-dynamic";

// 토큰/키는 원문을 응답에 싣지 않는다 — UI는 설정 여부만 알면 된다.
function masked() {
  const s = getSettings();
  return {
    defaultProvider: s.defaultProvider,
    maxConcurrentJobs: s.maxConcurrentJobs,
    jobTimeoutMinutes: s.jobTimeoutMinutes,
    figmaTokenSet: s.figmaToken.length > 0,
    cdnTemplate: s.cdnTemplate,
    claudeModel: s.claudeModel,
    notifyOnFinish: s.notifyOnFinish,
    providers: listProviders(),
  };
}

export async function GET() {
  return NextResponse.json(masked());
}

const settingsBody = z.object({
  defaultProvider: z.string().optional(),
  maxConcurrentJobs: z
    .number({ error: "동시 실행 수는 숫자여야 합니다." })
    .int()
    .min(1, "동시 실행 수는 1 이상이어야 합니다.")
    .max(5, "동시 실행 수는 5 이하여야 합니다.")
    .optional(),
  jobTimeoutMinutes: z
    .number({ error: "작업 제한 시간은 숫자여야 합니다." })
    .int()
    .min(5, "작업 제한 시간은 5분 이상이어야 합니다.")
    .max(180, "작업 제한 시간은 180분 이하여야 합니다.")
    .optional(),
  figmaToken: z.string().optional(),
  cdnTemplate: z.string().optional(),
  claudeModel: z
    .string()
    .max(64, "모델 이름이 너무 깁니다.")
    .regex(/^[\w.:-]*$/, "모델 이름에 쓸 수 없는 문자가 있습니다.")
    .optional(),
  notifyOnFinish: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const r = await readBody(req, settingsBody);
  if (!r.ok) return r.res;
  const body = r.data;

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

  saveSettings(body);
  return NextResponse.json({ ...masked(), warning: warnings.join(" ") || undefined });
}
