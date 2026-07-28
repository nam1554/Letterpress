"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { figmaLabel, formatElapsed } from "../../lib/format";
import ArtifactList, { type Artifact } from "./ArtifactList";
import LogViewer, { type AgentEvent } from "./LogViewer";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
  provider: string;
  status: string;
  createdAt: number;
  finishedAt?: number;
  summary?: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notify, setNotify] = useState(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // localStorage는 SSR에 없어 마운트 후 1회 동기화가 불가피하다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotify(localStorage.getItem("mhm-notify") === "1" && Notification.permission === "granted");
  }, []);

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
    // 재연결 시 서버가 히스토리를 다시 리플레이하므로 중복 방지를 위해 비운다.
    es.onopen = () => setEvents([]);
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
      void refresh();
    };
    return () => es.close();
  }, [id]);

  // 완료/실패 시 브라우저 알림 (옵트인).
  useEffect(() => {
    if (!job || notifiedRef.current) return;
    const terminal = job.status === "succeeded" || job.status === "failed";
    if (!terminal || !notify || Notification.permission !== "granted") return;
    // 페이지 진입 시점에 이미 끝나 있던 작업엔 알리지 않는다.
    if (job.finishedAt && Date.now() - job.finishedAt > 10_000) return;
    notifiedRef.current = true;
    new Notification(
      job.status === "succeeded" ? "eDM 변환 완료" : "eDM 변환 실패",
      { body: job.title || figmaLabel(job.figmaUrl) },
    );
  }, [job, notify]);

  const running = !!job && (job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function toggleNotify() {
    if (notify) {
      setNotify(false);
      localStorage.setItem("mhm-notify", "0");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotify(true);
      localStorage.setItem("mhm-notify", "1");
    }
  }

  async function cancel() {
    setActionError("");
    const res = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
    if (!res.ok) setActionError((await res.json()).error ?? "취소 실패");
  }

  async function rerun() {
    if (!job) return;
    setActionError("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figmaUrl: job.figmaUrl, provider: job.provider }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? "재실행 실패");
      return;
    }
    router.push(`/jobs/${data.job.id}`);
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setActionError("");
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setActionError((await res.json()).error ?? "삭제 실패");
      setConfirmDelete(false);
      return;
    }
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
        ← 홈으로
      </Link>

      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight">
          {job?.title || (job ? figmaLabel(job.figmaUrl) : `작업 ${id}`)}
        </h1>
        {job && (
          <span data-testid="job-status" className={`pill pill-${job.status}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        )}
      </header>
      {job && (
        <p className="mt-1 truncate font-mono text-xs" style={{ color: "var(--muted)" }}>
          {figmaLabel(job.figmaUrl)} · {job.provider} · 작업 {job.id}
        </p>
      )}

      {job && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span
            data-testid="elapsed"
            style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
          >
            소요 시간 {formatElapsed((job.finishedAt ?? now) - job.createdAt)}
          </span>
          <span className="flex-1" />
          {running && (
            <>
              <button onClick={toggleNotify} className="btn btn-ghost !py-1.5 text-xs">
                {notify ? "🔔 완료 시 알림 켜짐" : "🔕 완료 시 알림"}
              </button>
              <button data-testid="cancel" onClick={cancel} className="btn btn-danger !py-1.5 text-xs">
                취소
              </button>
            </>
          )}
          {!running && (
            <>
              <button data-testid="rerun" onClick={rerun} className="btn btn-ghost !py-1.5 text-xs">
                다시 실행
              </button>
              <button data-testid="delete" onClick={remove} className="btn btn-danger !py-1.5 text-xs">
                {confirmDelete ? "정말 삭제할까요?" : "삭제"}
              </button>
            </>
          )}
        </div>
      )}
      {actionError && (
        <p className="mt-2 text-sm" style={{ color: "var(--err)" }}>
          {actionError}
        </p>
      )}

      <h2 className="eyebrow mt-8">진행 로그</h2>
      <LogViewer events={events} />

      {job?.summary && (
        <p
          className="surface-card mt-4 p-3.5 text-sm"
          style={
            job.status === "failed"
              ? { borderColor: "var(--err)", background: "var(--err-soft)" }
              : job.status === "succeeded"
                ? { borderColor: "var(--ok)", background: "var(--ok-soft)" }
                : undefined
          }
        >
          {job.summary}
        </p>
      )}

      <ArtifactList jobId={id} artifacts={artifacts} running={running} />
    </main>
  );
}
