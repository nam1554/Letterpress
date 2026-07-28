"use client";

import { useEffect, useState } from "react";

/**
 * 발송 준비: 상대경로 이미지를 CDN URL로 치환한 교체본(hosted/)을 만든다.
 * 템플릿은 서버 설정에 저장돼 팀에서 재사용된다.
 */
export default function SendPrep({
  jobId,
  onCreated,
}: {
  jobId: string;
  onCreated: () => void;
}) {
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.cdnTemplate) setTemplate(s.cdnTemplate);
      })
      .catch(() => {});
  }, []);

  async function create() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/hosting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMessage(data.error ?? "생성 실패");
        return;
      }
      setIsError(false);
      if (data.created.length === 0) {
        setMessage("치환할 상대경로 이미지가 없습니다 (이미 호스팅/내장된 파일들).");
      } else {
        setMessage(
          `hosted/ 에 ${data.created.length}개 생성 (이미지 ${data.created.reduce((s: number, c: { replaced: number }) => s + c.replaced, 0)}건 치환)`,
        );
        onCreated();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card mt-9 p-5">
      <h2 className="eyebrow">발송 준비 — CDN 교체본</h2>
      <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
        images/ 폴더를 CDN에 올린 뒤, 아래 URL 템플릿으로 <code>src</code>를 일괄
        치환한 발송용 HTML을 만듭니다. 플레이스홀더: <code>{"{file}"}</code>(hero.jpg) ·{" "}
        <code>{"{name}"}</code>(hero) · <code>{"{ext}"}</code>(jpg)
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input
          data-testid="cdn-template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="https://cdn.example.com/edm/{file}"
          className="input flex-1 font-mono text-[13px]"
        />
        <button
          data-testid="cdn-create"
          onClick={create}
          disabled={busy || !template.trim()}
          className="btn btn-primary shrink-0 whitespace-nowrap"
        >
          {busy ? "생성 중…" : "교체본 생성"}
        </button>
      </div>
      {message && (
        <p
          data-testid="cdn-message"
          className="mt-2 text-xs"
          style={{ color: isError ? "var(--err)" : "var(--ok)" }}
        >
          {message}
        </p>
      )}
    </section>
  );
}
