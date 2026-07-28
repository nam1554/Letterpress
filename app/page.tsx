"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Job {
  id: string;
  figmaUrl: string;
  provider: string;
  status: string;
  createdAt: number;
  summary?: string;
}
interface ProviderInfo {
  id: string;
  label: string;
}

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200",
};

export default function Home() {
  const router = useRouter();
  const [figmaUrl, setFigmaUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs);
    setProviders(data.providers);
    setProvider((p) => p || data.defaultProvider);
  }, []);

  useEffect(() => {
    // load()는 async — setState는 fetch 완료 후 콜백에서 일어난다 (lint false positive)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl, provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "요청 실패");
        return;
      }
      router.push(`/jobs/${data.job.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <h1 className="text-3xl font-bold tracking-tight">Marketing HTML Maker</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Figma eDM 디자인 링크를 붙여넣으면 에이전트가 이메일 HTML로 변환합니다.
        완료 후 HTML과 이미지 폴더를 zip으로 다운로드하세요.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          data-testid="figma-url"
          type="url"
          required
          value={figmaUrl}
          onChange={(e) => setFigmaUrl(e.target.value)}
          placeholder="https://www.figma.com/design/…?node-id=2343-115"
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center gap-3">
          <select
            data-testid="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            data-testid="submit"
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "생성 중…" : "HTML 만들기"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <h2 className="mt-12 text-lg font-semibold">작업 히스토리</h2>
      <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {jobs.length === 0 && (
          <li className="px-4 py-6 text-sm text-zinc-500">아직 작업이 없습니다.</li>
        )}
        {jobs.map((job) => (
          <li key={job.id}>
            <a
              href={`/jobs/${job.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status] ?? ""}`}
              >
                {job.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{job.figmaUrl}</span>
              <span className="text-xs text-zinc-400">
                {new Date(job.createdAt).toLocaleString("ko-KR")}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
