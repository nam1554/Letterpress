"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SettingsPanel from "./components/SettingsPanel";

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
interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
  optional?: boolean;
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
  const [health, setHealth] = useState<HealthCheck[] | null>(null);

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
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d.checks))
      .catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function createAndGo(url: string, providerId: string) {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl: url, provider: providerId }),
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await createAndGo(figmaUrl, provider);
  }

  // 삭제는 행 단위 2단계 확인 (브라우저 confirm 다이얼로그 미사용).
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function removeJob(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (res.ok) void load();
    else setError((await res.json()).error ?? "삭제 실패");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <h1 className="text-3xl font-bold tracking-tight">Marketing HTML Maker</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Figma eDM 디자인 링크를 붙여넣으면 에이전트가 이메일 HTML로 변환합니다.
        완료 후 HTML과 이미지 폴더를 zip으로 다운로드하세요.
      </p>

      {health && health.some((c) => !c.ok && !c.optional) && (
        <div
          data-testid="health-banner"
          className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950"
        >
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            환경 점검이 필요합니다 — 변환이 실패할 수 있어요
          </p>
          <ul className="mt-2 space-y-1 text-amber-800 dark:text-amber-300">
            {health
              .filter((c) => !c.ok && !c.optional)
              .map((c) => (
                <li key={c.name}>
                  <b>{c.name}</b>: {c.detail}
                  {c.hint && <span className="block text-xs opacity-80">→ {c.hint}</span>}
                </li>
              ))}
          </ul>
        </div>
      )}
      {health && health.filter((c) => !c.optional).every((c) => c.ok) && (
        <p className="mt-6 text-xs text-green-600 dark:text-green-400" data-testid="health-ok">
          ✓ 환경 점검 통과 (Claude CLI · figma-edm 스킬 · Chrome · Python 의존성)
        </p>
      )}
      {health && health.some((c) => !c.ok && c.optional) && (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-400" data-testid="health-optional">
          {health
            .filter((c) => !c.ok && c.optional)
            .map((c) => (
              <li key={c.name}>
                ○ {c.name}: {c.detail}
                {c.hint && <span> — {c.hint}</span>}
              </li>
            ))}
        </ul>
      )}

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

      <SettingsPanel onSaved={load} />

      <h2 className="mt-12 text-lg font-semibold">작업 히스토리</h2>
      <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {jobs.length === 0 && (
          <li className="px-4 py-6 text-sm text-zinc-500">
            아직 작업이 없습니다.
            <button
              data-testid="try-mock"
              onClick={() => createAndGo("https://www.figma.com/design/EXAMPLEfileKey12345678/?node-id=2343-115", "mock")}
              disabled={submitting}
              className="ml-3 rounded-lg border border-blue-300 px-3 py-1 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950"
            >
              샘플로 체험해보기 (토큰 소모 없음)
            </button>
          </li>
        )}
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <a href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3">
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
            {job.status === "succeeded" && (
              <a
                href={`/api/jobs/${job.id}/download`}
                className="text-xs text-blue-600 hover:underline"
              >
                zip
              </a>
            )}
            {job.status !== "running" && job.status !== "queued" && (
              <button
                onClick={() => removeJob(job.id)}
                className="text-xs text-red-500 hover:underline"
              >
                {confirmId === job.id ? "정말 삭제?" : "삭제"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
