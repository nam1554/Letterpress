import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { listProviders } from "@/lib/providers/registry";
import { runBackendTest } from "@/lib/setup";


/** 선택한 백엔드로 초소형 프롬프트를 실제 스폰해 왕복을 확인한다 (최대 2분). */
export async function POST(req: NextRequest) {
  const r = await readBody(
    req,
    z.object({ provider: z.string({ error: "provider가 필요합니다." }) }),
  );
  if (!r.ok) return r.res;
  const provider = r.data.provider;
  if (!listProviders().some((p) => p.id === provider)) {
    return NextResponse.json({ error: "알 수 없는 백엔드입니다." }, { status: 400 });
  }
  try {
    const result = await runBackendTest(provider);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `테스트 실행 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
