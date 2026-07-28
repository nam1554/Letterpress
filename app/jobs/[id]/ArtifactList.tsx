"use client";

import { formatSize } from "../../lib/format";

export interface Artifact {
  rel: string;
  size: number;
}

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
          <li key={a.rel} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{a.rel}</span>
            <span
              className="text-xs"
              style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
            >
              {formatSize(a.size)}
            </span>
            {a.rel.endsWith(".html") && (
              <a
                href={`/jobs/${jobId}/view?file=${encodeURIComponent(a.rel)}`}
                target="_blank"
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)" }}
              >
                미리보기
              </a>
            )}
            <a
              href={`/api/jobs/${jobId}/download?file=${encodeURIComponent(a.rel)}`}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--accent)" }}
            >
              다운로드
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
