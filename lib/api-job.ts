import { NextResponse } from "next/server";
import { getJob, type Job } from "./jobs/store";

/**
 * 잡 존재 확인 + 404 응답 공통 헬퍼 — readBody(lib/api-body.ts)와 같은
 * `{ok}|{res}` 패턴. 라우트는 `if (!j.ok) return j.res;` 한 줄로 처리한다.
 * 문구·형식이 라우트마다 갈라지지 않게 여기 한 곳에만 둔다.
 */
export async function requireJob(
  id: string,
): Promise<{ ok: true; job: Job } | { ok: false; res: NextResponse }> {
  const job = await getJob(id);
  if (!job) {
    return {
      ok: false,
      res: NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 }),
    };
  }
  return { ok: true, job };
}
