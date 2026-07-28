"use client";

import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

function CopyHtmlButton({ src }: { src: string }) {
  const [label, setLabel] = useState("HTML 복사");
  async function copy() {
    try {
      const html = await (await fetch(src)).text();
      await navigator.clipboard.writeText(html);
      setLabel("복사됨 ✓");
    } catch {
      setLabel("복사 실패");
    }
    setTimeout(() => setLabel("HTML 복사"), 2000);
  }
  return (
    <button data-testid="copy-html" onClick={copy} className="btn btn-ghost !py-1.5 text-xs">
      {label}
    </button>
  );
}

const WIDTHS = [
  { key: "desktop", label: "데스크톱 700px", width: 700 },
  { key: "tablet", label: "태블릿 600px", width: 600 },
  { key: "mobile", label: "모바일 375px", width: 375 },
] as const;

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const file = useSearchParams().get("file") ?? "";
  const [width, setWidth] = useState<number>(700);

  if (!file) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-14">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          미리볼 파일이 지정되지 않았습니다.{" "}
          <Link href={`/jobs/${id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
            작업 페이지로 돌아가기
          </Link>
        </p>
      </main>
    );
  }

  const src = `/api/jobs/${id}/preview/${file}`;

  return (
    <main className="flex min-h-screen flex-col" style={{ background: "var(--surface-2)" }}>
      <header
        className="flex items-center gap-3 px-5 py-3 text-sm"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        <Link href={`/jobs/${id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
          ← 작업으로
        </Link>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          style={{ color: "var(--muted)" }}
        >
          {file}
        </span>
        {WIDTHS.map((w) => (
          <button
            key={w.key}
            data-testid={`width-${w.key}`}
            onClick={() => setWidth(w.width)}
            className={`btn !py-1.5 text-xs ${width === w.width ? "btn-primary" : "btn-ghost"}`}
          >
            {w.label}
          </button>
        ))}
        <CopyHtmlButton src={src} />
        <a
          href={src}
          target="_blank"
          className="hover:underline"
          style={{ color: "var(--accent)" }}
        >
          원본 열기
        </a>
      </header>

      <div className="flex flex-1 justify-center overflow-auto p-6">
        <iframe
          data-testid="preview-frame"
          src={src}
          style={{
            width,
            background: "#fff",
            border: "1px solid var(--border)",
            transition: "width 200ms ease",
          }}
          className="min-h-full rounded-[10px] shadow-sm"
          title="eDM preview"
        />
      </div>
    </main>
  );
}

export default function ViewerPage() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
