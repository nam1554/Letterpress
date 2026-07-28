"use client";

import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

const WIDTHS = [
  { key: "desktop", label: "데스크톱 700px", width: 700 },
  { key: "tablet", label: "태블릿 600px", width: 600 },
  { key: "mobile", label: "모바일 375px", width: 375 },
] as const;

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const file = useSearchParams().get("file") ?? "";
  const [width, setWidth] = useState<number>(700);

  const src = `/api/jobs/${id}/preview/${file}`;

  return (
    <main className="flex min-h-screen flex-col bg-zinc-100 font-sans dark:bg-zinc-950">
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-5 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Link href={`/jobs/${id}`} className="text-blue-600 hover:underline">
          ← 작업으로
        </Link>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500">{file}</span>
        {WIDTHS.map((w) => (
          <button
            key={w.key}
            data-testid={`width-${w.key}`}
            onClick={() => setWidth(w.width)}
            className={`rounded-lg px-3 py-1.5 ${
              width === w.width
                ? "bg-blue-600 text-white"
                : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {w.label}
          </button>
        ))}
        <a href={src} target="_blank" className="text-blue-600 hover:underline">
          원본 열기
        </a>
      </header>

      <div className="flex flex-1 justify-center overflow-auto p-6">
        <iframe
          data-testid="preview-frame"
          src={src}
          style={{ width }}
          className="min-h-full rounded-lg border border-zinc-300 bg-white shadow-sm dark:border-zinc-700"
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
