"use client";

import { useState } from "react";
import { formatSize } from "../../lib/format";

export interface Artifact {
  rel: string;
  size: number;
}

interface EmailCheck {
  name: string;
  level: "ok" | "warn" | "fail";
  detail: string;
}

const LEVEL_COLOR: Record<EmailCheck["level"], string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  fail: "var(--err)",
};
const LEVEL_ICON: Record<EmailCheck["level"], string> = { ok: "✓", warn: "△", fail: "✗" };

/** 산출물 목록 + zip 다운로드 헤더. */
export default function ArtifactList({
  jobId,
  artifacts,
  running,
}: {
  jobId: string;
  artifacts: Artifact[];
  running: boolean;
}) {
  const [checkFor, setCheckFor] = useState<string | null>(null);
  const [checks, setChecks] = useState<EmailCheck[] | null>(null);

  async function toggleCheck(rel: string) {
    if (checkFor === rel) {
      setCheckFor(null);
      return;
    }
    setCheckFor(rel);
    setChecks(null);
    const res = await fetch(`/api/jobs/${jobId}/check?file=${encodeURIComponent(rel)}`);
    if (res.ok) setChecks((await res.json()).checks);
    else setChecks([{ name: "검사", level: "fail", detail: "검사 실패" }]);
  }

  return (
    <>
      <div className="mt-9 flex items-center justify-between">
        <h2 className="text-lg font-semibold">산출물 ({artifacts.length})</h2>
        {artifacts.length > 0 && (
          <a
            data-testid="download-zip"
            href={`/api/jobs/${jobId}/download`}
            className="btn btn-primary"
          >
            전체 zip 다운로드
          </a>
        )}
      </div>
      <ul className="surface-card hairline-list mt-3 overflow-hidden">
        {artifacts.length === 0 && (
          <li className="px-5 py-5 text-sm" style={{ color: "var(--muted)" }}>
            {running ? "작업이 끝나면 여기에 파일이 나타납니다." : "산출물이 없습니다."}
          </li>
        )}
        {artifacts.map((a) => (
          <li key={a.rel}>
            <div className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{a.rel}</span>
              <span
                className="text-xs"
                style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {formatSize(a.size)}
              </span>
              {a.rel.endsWith(".html") && (
                <>
                  <button
                    data-testid={`check-${a.rel}`}
                    onClick={() => toggleCheck(a.rel)}
                    className="text-xs font-medium hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {checkFor === a.rel ? "검사 닫기" : "검사"}
                  </button>
                  <a
                    href={`/jobs/${jobId}/view?file=${encodeURIComponent(a.rel)}`}
                    target="_blank"
                    className="text-xs font-medium hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    미리보기
                  </a>
                </>
              )}
              <a
                href={`/api/jobs/${jobId}/download?file=${encodeURIComponent(a.rel)}`}
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)" }}
              >
                다운로드
              </a>
            </div>
            {checkFor === a.rel && (
              <ul
                data-testid="check-results"
                className="space-y-1 px-5 pb-3 text-xs"
                style={{ background: "var(--surface-2)" }}
              >
                {!checks && <li className="pt-2" style={{ color: "var(--muted)" }}>검사 중…</li>}
                {checks?.map((c) => (
                  <li key={c.name} className="flex gap-2 pt-2">
                    <span className="shrink-0 font-semibold" style={{ color: LEVEL_COLOR[c.level] }}>
                      {LEVEL_ICON[c.level]} {c.name}
                    </span>
                    <span style={{ color: "var(--muted)" }}>{c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
