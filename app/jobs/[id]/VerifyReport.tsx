"use client";

import { useState } from "react";

const LABELS: Record<string, string> = {
  side_by_side: "Figma ↔ 렌더 비교",
  diff_heat: "차이 히트맵",
  figma_full: "Figma 원본 캡처",
  my_full: "HTML 렌더 캡처",
};

/** 픽셀 검증 리포트 — 파이프라인이 남긴 비교 이미지를 눈으로 확인. */
export default function VerifyReport({
  jobId,
  files,
}: {
  jobId: string;
  files: string[];
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;

  const isInline = (f: string) => f === "side_by_side.png" || f === "diff_heat.png";
  const inline = files.filter(isInline);
  const linksOnly = files.filter((f) => !isInline(f));
  const url = (f: string) => `/api/jobs/${jobId}/verify/${f}`;

  return (
    <section className="surface-card mt-4 overflow-hidden">
      <button
        data-testid="verify-toggle"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium"
      >
        <span>픽셀 검증 리포트</span>
        <span style={{ color: "var(--muted)" }}>{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="space-y-4 px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          {inline.map((f) => (
            <figure key={f}>
              <figcaption className="eyebrow mb-1.5">
                {LABELS[f.replace(".png", "")] ?? f}
              </figcaption>
              <a href={url(f)} target="_blank">
                {/* 산출 이미지는 동적 파일이라 next/image 최적화 대상이 아니다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url(f)}
                  alt={f}
                  className="w-full rounded-lg"
                  style={{ border: "1px solid var(--border)" }}
                />
              </a>
            </figure>
          ))}
          {linksOnly.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              원본 캡처:{" "}
              {linksOnly.map((f, i) => (
                <span key={f}>
                  {i > 0 && " · "}
                  <a
                    href={url(f)}
                    target="_blank"
                    className="hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {LABELS[f.replace(".png", "")] ?? f}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
