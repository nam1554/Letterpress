"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Job {
  id: string;
  figmaUrl: string;
  provider: string;
  status: string;
  createdAt: number;
  finishedAt?: number;
  summary?: string;
}
interface Artifact {
  rel: string;
  size: number;
}
interface AgentEvent {
  ts: number;
  type: string;
  text: string;
}

const TYPE_COLOR: Record<string, string> = {
  status: "text-blue-600 dark:text-blue-400",
  tool: "text-zinc-500",
  error: "text-red-600 dark:text-red-400",
  done: "text-green-600 dark:text-green-400",
  log: "text-zinc-800 dark:text-zinc-200",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    const refresh = async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
      setArtifacts(data.artifacts);
    };
    void refresh();

    const es = new EventSource(`/api/jobs/${id}/events`);
    es.addEventListener("agent", (e) => {
      setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });
    es.addEventListener("state", (e) => {
      const next = JSON.parse((e as MessageEvent).data) as Job | null;
      if (next) {
        setJob(next);
        if (next.status === "succeeded" || next.status === "failed") {
          void refresh();
          es.close();
        }
      }
    });
    es.onerror = () => {
      // Terminal jobs close the stream server-side; avoid endless reconnects.
      void refresh();
    };
    return () => es.close();
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← 홈으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">
        작업 {id}
        {job && (
          <span
            data-testid="job-status"
            className={`ml-3 align-middle text-sm font-medium ${
              job.status === "succeeded"
                ? "text-green-600"
                : job.status === "failed"
                  ? "text-red-600"
                  : "text-blue-600"
            }`}
          >
            {job.status}
            {running && "…"}
          </span>
        )}
      </h1>
      {job && (
        <p className="mt-1 truncate text-sm text-zinc-500">
          {job.figmaUrl} · {job.provider}
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">진행 로그</h2>
      <div
        ref={logRef}
        data-testid="log"
        className="mt-3 h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950"
      >
        {events.length === 0 && <p className="text-zinc-400">이벤트 대기 중…</p>}
        {events.map((e, i) => (
          <p key={i} className={`whitespace-pre-wrap ${TYPE_COLOR[e.type] ?? ""}`}>
            <span className="mr-2 text-zinc-400">
              {new Date(e.ts).toLocaleTimeString("ko-KR", { hour12: false })}
            </span>
            {e.text}
          </p>
        ))}
      </div>

      {job?.summary && (
        <p className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {job.summary}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">산출물 ({artifacts.length})</h2>
        {artifacts.length > 0 && (
          <a
            data-testid="download-zip"
            href={`/api/jobs/${id}/download`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            전체 zip 다운로드
          </a>
        )}
      </div>
      <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {artifacts.length === 0 && (
          <li className="px-4 py-5 text-sm text-zinc-500">
            {running ? "작업이 끝나면 여기에 파일이 나타납니다." : "산출물이 없습니다."}
          </li>
        )}
        {artifacts.map((a) => (
          <li key={a.rel} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono">{a.rel}</span>
            <span className="text-xs text-zinc-400">{formatSize(a.size)}</span>
            {a.rel.endsWith(".html") && (
              <a
                href={`/api/jobs/${id}/preview/${a.rel}`}
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                미리보기
              </a>
            )}
            <a
              href={`/api/jobs/${id}/download?file=${encodeURIComponent(a.rel)}`}
              className="text-blue-600 hover:underline"
            >
              다운로드
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
