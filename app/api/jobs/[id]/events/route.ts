import { requireJob } from "@/lib/api-job";
import { getJob, readEvents, STALE_GRACE_MS, subscribe } from "@/lib/jobs/store";
import type { AgentEvent } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * SSE stream: replays events.ndjson, then relays live events.
 * Emits a final "state" event when the job reaches a terminal status.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const j = await requireJob(id);
  if (!j.ok) return j.res;

  // start()가 끝나기 전에 스트림이 취소될 수 있어 cancel()에서도 닿아야 한다.
  let unsubscribe = () => {};
  let recheck: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearTimeout(recheck);
        const latest = await getJob(id);
        try {
          controller.enqueue(sse("state", latest));
          controller.close();
        } catch {
          /* client already gone */
        }
      };

      /** 한 이벤트를 보낸다. 클라이언트가 이미 사라졌으면 false. */
      const send = (e: AgentEvent): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(sse("agent", e));
          return true;
        } catch {
          void close();
          return false;
        }
      };

      const push = (e: AgentEvent) => {
        if (!send(e)) return;
        if (e.type === "done" || e.type === "error") {
          // Terminal lifecycle events come from the runner; finish the stream.
          setTimeout(() => void close(), 100);
        }
      };

      // 이탈 감지를 구독보다 먼저 건다. 리플레이는 파일 읽기를 기다리는 구간이라
      // 그 사이 탭이 닫히는 일이 흔한데, 등록이 뒤에 있으면 그 연결의 구독은
      // 영영 정리되지 않는다.
      if (req.signal.aborted) {
        try {
          controller.close();
        } catch {
          /* already gone */
        }
        return;
      }
      req.signal.addEventListener("abort", () => void close());

      // Subscribe BEFORE replay so no live event falls in the gap.
      const pending: AgentEvent[] = [];
      let replaying = true;
      unsubscribe = subscribe(id, (e) => (replaying ? pending.push(e) : push(e)));
      // 구독 등록 직전에 이탈했다면 close()의 unsubscribe가 아직 no-op이었다.
      if (closed) {
        unsubscribe();
        return;
      }

      const history = await readEvents(id);
      for (const e of history) if (!send(e)) return;
      replaying = false;
      // 리플레이/라이브 경계 중복은 시퀀스로 정확히 자른다. seq 없는 과거
      // 이벤트는 라인 수가 곧 시퀀스다 (appendEvent가 라인 수 기반으로 이어감).
      const lastSeq = history.at(-1)?.seq ?? history.length;
      for (const e of pending) if ((e.seq ?? 0) > lastSeq) push(e);
      if (closed) return;

      const current = await getJob(id);
      try {
        controller.enqueue(sse("state", current));
      } catch {
        await close();
        return;
      }
      if (current && (current.status === "succeeded" || current.status === "failed")) {
        await close();
        return;
      }

      // 서버 재시작 직후 유예 기간(STALE_GRACE_MS) 안에 접속하면 reconcile이
      // 아직 돌지 않아 죽은 잡도 "실행 중"으로 온다. 그대로 두면 이 스트림은
      // 영원히 기다리고 화면은 실행 중에서 멈춘다 — 유예가 끝난 뒤 한 번 더
      // 읽어 준다. 러너가 살아 있으면 아무 일도 일어나지 않고, 죽었다면 그
      // 읽기가 reconcile을 돌려 실패 이벤트가 구독자로 흘러온다.
      if (current) {
        const wait = current.createdAt + STALE_GRACE_MS - Date.now() + 500;
        recheck = setTimeout(() => void getJob(id), Math.max(wait, 0));
      }
    },
    // 클라이언트가 스트림을 취소했을 때의 두 번째 정리 경로 — req.signal이
    // 발화하지 않는 런타임에서도 구독이 남지 않도록.
    cancel() {
      unsubscribe();
      clearTimeout(recheck);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
