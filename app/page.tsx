"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SettingsPanel from "./components/SettingsPanel";
import { parseFigmaUrl } from "@/lib/figma";
import { figmaLabel, relativeTime } from "./lib/format";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
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

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
};

// URL 파싱은 서버와 동일한 lib/figma.parseFigmaUrl을 그대로 사용한다
// (순수 함수라 클라이언트 번들에서도 동작 — 검증 규칙이 항상 일치).

export default function Home() {
  const router = useRouter();
  const [figmaUrl, setFigmaUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState<HealthCheck[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function clearHistory() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const res = await fetch("/api/jobs", { method: "DELETE" });
    if (res.ok) void load();
    else setError("일괄 삭제 실패");
  }

  const parsed = useMemo(
    () => (figmaUrl.trim() ? parseFigmaUrl(figmaUrl) : undefined),
    [figmaUrl],
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs);
    setProviders(data.providers);
    setProvider((p) => p || data.defaultProvider);
  }, []);

  useEffect(() => {
    // load()는 async — setState는 fetch 완료 후 콜백에서 일어난다 (lint false positive)
     
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

  const requiredFails = health?.filter((c) => !c.ok && !c.optional) ?? [];
  const optionalFails = health?.filter((c) => !c.ok && c.optional) ?? [];

  async function recheckHealth() {
    setHealth(null);
    try {
      const res = await fetch("/api/health?force=1");
      setHealth((await res.json()).checks);
    } catch {
      /* 표시 유지 */
    }
  }
  const recheckButton = (
    <button
      data-testid="health-recheck"
      onClick={recheckHealth}
      className="ml-2 hover:underline"
      style={{ color: "var(--muted)" }}
    >
      다시 점검
    </button>
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <header className="flex items-baseline gap-3">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ textWrap: "balance" }}>
          Marketing HTML Maker
        </h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Figma → eDM HTML
        </span>
      </header>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        Figma 디자인 링크를 붙여넣으면 에이전트가 픽셀 검증까지 마친 이메일
        HTML을 만들어 드립니다. 완료 후 HTML + 이미지 폴더를 zip으로 받으세요.
      </p>

      {requiredFails.length > 0 && (
        <div
          data-testid="health-banner"
          className="surface-card mt-6 p-4 text-sm"
          style={{ borderColor: "var(--warn)", background: "var(--warn-soft)" }}
        >
          <p className="font-semibold" style={{ color: "var(--warn)" }}>
            환경 점검이 필요합니다 — 변환이 실패할 수 있어요
          </p>
          <ul className="mt-2 space-y-1.5">
            {requiredFails.map((c) => (
              <li key={c.name}>
                <b>{c.name}</b>: {c.detail}
                {c.hint && (
                  <span className="block text-xs" style={{ color: "var(--muted)" }}>
                    → {c.hint}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">{recheckButton}</p>
        </div>
      )}
      {health && requiredFails.length === 0 && (
        <p className="mt-5 text-xs" data-testid="health-ok" style={{ color: "var(--ok)" }}>
          ✓ 환경 점검 통과 — Claude CLI · figma-edm 스킬 · Chrome · Python
          {recheckButton}
        </p>
      )}
      {optionalFails.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs" data-testid="health-optional" style={{ color: "var(--muted)" }}>
          {optionalFails.map((c) => (
            <li key={c.name}>
              ○ {c.name}: {c.detail}
              {c.hint && <span> — {c.hint}</span>}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="surface-card mt-8 space-y-4 p-5">
        <div>
          <label className="eyebrow" htmlFor="figma-url">
            Figma 디자인 URL
          </label>
          <input
            id="figma-url"
            data-testid="figma-url"
            type="url"
            required
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            placeholder="https://www.figma.com/design/…?node-id=2343-115"
            className="input mt-1.5 font-mono text-[13px]"
          />
          {parsed === null && (
            <p className="mt-1.5 text-xs" style={{ color: "var(--err)" }}>
              Figma 디자인 URL 형식이 아닙니다 (figma.com/design/… 링크를 붙여넣으세요)
            </p>
          )}
          {parsed && (
            <p className="mt-1.5 text-xs" data-testid="url-parsed" style={{ color: "var(--ok)" }}>
              ✓ {parsed.title || parsed.fileKey}
              {parsed.nodeId
                ? ` · 노드 ${parsed.nodeId.replace(/:/g, "-")}`
                : " · 노드 미지정 (URL에 node-id 권장)"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            data-testid="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="input w-auto"
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
            disabled={submitting || parsed === null}
            className="btn btn-primary shrink-0 whitespace-nowrap"
          >
            {submitting ? "생성 중…" : "HTML 만들기"}
          </button>
        </div>
        {error && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
      </form>

      <SettingsPanel onSaved={load} />

      <div className="mt-12 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">작업 히스토리</h2>
        <span className="flex items-baseline gap-3 text-xs" style={{ color: "var(--muted)" }}>
          {jobs.length > 0 && `${jobs.length}건`}
          {jobs.some((j) => j.status === "succeeded" || j.status === "failed") && (
            <button
              data-testid="clear-history"
              onClick={clearHistory}
              className="hover:underline"
              style={{ color: "var(--err)" }}
            >
              {confirmClear ? "정말 모두 삭제?" : "완료된 작업 모두 삭제"}
            </button>
          )}
        </span>
      </div>
      <ul className="surface-card hairline-list mt-3 overflow-hidden">
        {jobs.length === 0 && (
          <li className="px-5 py-6 text-sm" style={{ color: "var(--muted)" }}>
            아직 작업이 없습니다.
            <button
              data-testid="try-mock"
              onClick={() =>
                createAndGo(
                  "https://www.figma.com/design/EXAMPLEfileKey12345678/?node-id=2343-115",
                  "mock",
                )
              }
              disabled={submitting}
              className="btn btn-ghost ml-3 !py-1 text-xs"
              style={{ color: "var(--accent)" }}
            >
              샘플로 체험해보기 (토큰 소모 없음)
            </button>
          </li>
        )}
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-3 px-5 py-3.5">
            <a href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span className={`pill pill-${job.status}`}>
                {STATUS_LABEL[job.status] ?? job.status}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {job.title || figmaLabel(job.figmaUrl)}
                </span>
                <span
                  className="block truncate font-mono text-[11px]"
                  style={{ color: "var(--muted)" }}
                >
                  {job.title ? `${figmaLabel(job.figmaUrl)} · ` : ""}
                  {job.provider}
                </span>
              </span>
              <span
                className="shrink-0 text-xs"
                style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {relativeTime(job.createdAt)}
              </span>
            </a>
            {job.status === "succeeded" && (
              <a
                href={`/api/jobs/${job.id}/download`}
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)" }}
              >
                zip
              </a>
            )}
            {job.status !== "running" && job.status !== "queued" && (
              <button
                onClick={() => removeJob(job.id)}
                className="text-xs hover:underline"
                style={{ color: "var(--err)" }}
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
