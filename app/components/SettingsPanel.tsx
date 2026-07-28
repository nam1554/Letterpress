"use client";

import { useEffect, useState } from "react";

interface ProviderInfo {
  id: string;
  label: string;
}
interface SettingsView {
  defaultProvider: string;
  maxConcurrentJobs: number;
  jobTimeoutMinutes: number;
  figmaTokenSet: boolean;
  providers: ProviderInfo[];
}

/** 홈 화면의 접이식 설정 패널 — 환경변수 없이 모든 설정을 화면에서. */
export default function SettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SettingsView | null>(null);
  const [figmaToken, setFigmaToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setView)
      .catch(() => {});
  }, []);

  if (!view) return null;

  async function save() {
    if (!view) return;
    setSaving(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        defaultProvider: view.defaultProvider,
        maxConcurrentJobs: view.maxConcurrentJobs,
        jobTimeoutMinutes: view.jobTimeoutMinutes,
      };
      if (figmaToken.trim()) body.figmaToken = figmaToken.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "저장 실패");
        return;
      }
      setView(data);
      setFigmaToken("");
      setMessage("저장되었습니다.");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function clearToken() {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figmaToken: "" }),
    });
    if (res.ok) {
      setView(await res.json());
      setMessage("토큰을 삭제했습니다.");
    }
  }

  return (
    <section className="surface-card mt-6 overflow-hidden">
      <button
        data-testid="settings-toggle"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium"
      >
        <span>⚙️ 설정</span>
        <span style={{ color: "var(--muted)" }}>{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      {open && (
        <div
          className="space-y-5 px-5 py-4 text-sm"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <label className="flex items-center justify-between gap-4">
            <span>
              기본 백엔드
              <span className="block text-xs" style={{ color: "var(--muted)" }}>
                새 작업 폼의 기본 선택값
              </span>
            </span>
            <select
              data-testid="setting-provider"
              value={view.defaultProvider}
              onChange={(e) => setView({ ...view, defaultProvider: e.target.value })}
              className="input w-auto"
            >
              {view.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4">
            <span>
              동시 실행 작업 수
              <span className="block text-xs" style={{ color: "var(--muted)" }}>
                변환 1건이 10~25분 걸립니다. 머신 부하를 고려해 1~3 권장
              </span>
            </span>
            <input
              data-testid="setting-concurrent"
              type="number"
              min={1}
              max={5}
              value={view.maxConcurrentJobs}
              onChange={(e) => setView({ ...view, maxConcurrentJobs: Number(e.target.value) })}
              className="input w-24"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <span>
              작업 제한 시간 (분)
              <span className="block text-xs" style={{ color: "var(--muted)" }}>
                초과 시 자동 중단
              </span>
            </span>
            <input
              data-testid="setting-timeout"
              type="number"
              min={5}
              max={180}
              value={view.jobTimeoutMinutes}
              onChange={(e) => setView({ ...view, jobTimeoutMinutes: Number(e.target.value) })}
              className="input w-24"
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <span>
              Figma 토큰 (선택)
              <span className="block max-w-90 text-xs" style={{ color: "var(--muted)" }}>
                Figma MCP를 못 쓰는 환경(무료 시트 등)용 REST API 폴백. figma.com →
                설정 → Security → Personal access tokens에서 발급해 직접
                붙여넣으세요. 이 컴퓨터의 data/settings.json에만 저장됩니다.
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {view.figmaTokenSet && !figmaToken && (
                <>
                  <span className="text-xs" style={{ color: "var(--ok)" }}>
                    설정됨
                  </span>
                  <button
                    onClick={clearToken}
                    className="text-xs hover:underline"
                    style={{ color: "var(--err)" }}
                  >
                    삭제
                  </button>
                </>
              )}
              <input
                data-testid="setting-figma-token"
                type="password"
                value={figmaToken}
                onChange={(e) => setFigmaToken(e.target.value)}
                placeholder={view.figmaTokenSet ? "변경하려면 입력" : "figd_…"}
                className="input w-40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              data-testid="settings-save"
              onClick={save}
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
            {message && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {message}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
