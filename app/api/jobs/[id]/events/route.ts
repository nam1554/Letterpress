import { getJob, readEvents, subscribe } from "@/lib/jobs/store";
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
  const job = await getJob(id);
  if (!job) return new Response("not found", { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const close = async () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        const latest = await getJob(id);
        try {
          controller.enqueue(sse("state", latest));
          controller.close();
        } catch {
          /* client already gone */
        }
      };

      const push = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sse("agent", e));
        } catch {
          void close();
          return;
        }
        if (e.type === "done" || e.type === "error") {
          // Terminal lifecycle events come from the runner; finish the stream.
          setTimeout(() => void close(), 100);
        }
      };

      // Subscribe BEFORE replay so no live event falls in the gap.
      const pending: AgentEvent[] = [];
      let replaying = true;
      unsubscribe = subscribe(id, (e) => (replaying ? pending.push(e) : push(e)));

      const history = await readEvents(id);
      for (const e of history) controller.enqueue(sse("agent", e));
      replaying = false;
      // 리플레이/라이브 경계 중복은 시퀀스로 정확히 자른다. seq 없는 과거
      // 이벤트는 라인 수가 곧 시퀀스다 (appendEvent가 라인 수 기반으로 이어감).
      const lastSeq = history.at(-1)?.seq ?? history.length;
      for (const e of pending) if ((e.seq ?? 0) > lastSeq) push(e);

      const current = await getJob(id);
      controller.enqueue(sse("state", current));
      if (current && (current.status === "succeeded" || current.status === "failed")) {
        await close();
        return;
      }

      req.signal.addEventListener("abort", () => void close());
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
