import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { deleteJob, getJob } from "@/lib/jobs/store";


const body = z.object({ ids: z.array(z.string()).min(1).max(200) });

/** 선택 삭제 — 잡별 성공/거부를 개별 반환해 부분 실패가 전체를 막지 않는다. */
export async function POST(req: NextRequest) {
  const r = await readBody(req, body);
  if (!r.ok) return r.res;

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of r.data.ids) {
    // deleteJob은 없는 id에도 true를 돌려준다(rm force) — 존재를 먼저 확인해
    // 사용자가 지운 개수를 정직하게 보고한다.
    if (!(await getJob(id))) {
      results.push({ id, ok: false, error: "존재하지 않는 잡입니다." });
      continue;
    }
    const ok = await deleteJob(id);
    results.push(ok ? { id, ok } : { id, ok, error: "실행 중인 잡은 삭제할 수 없습니다." });
  }
  return NextResponse.json({ results });
}
