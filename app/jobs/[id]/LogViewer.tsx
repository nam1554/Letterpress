"use client";

import { useEffect, useRef } from "react";

export interface AgentEvent {
  ts: number;
  type: string;
  text: string;
  seq?: number;
}

const LOG_COLOR: Record<string, string> = {
  status: "#7dd3c8",
  tool: "#6b7f7a",
  error: "#f87171",
  done: "#4ade80",
  log: "var(--terminal-ink)",
};

/** 상시 다크 터미널 서피스의 진행 로그 뷰어 (자동 스크롤). */
export default function LogViewer({ events }: { events: AgentEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events]);

  return (
    <div
      ref={ref}
      data-testid="log"
      className="mt-2 h-72 overflow-y-auto rounded-[10px] p-4 font-mono text-xs leading-relaxed"
      style={{ background: "var(--terminal-bg)", color: "var(--terminal-ink)" }}
    >
      {events.length === 0 && <p style={{ opacity: 0.5 }}>이벤트 대기 중…</p>}
      {events.map((e, i) => (
        <p
          key={e.seq ?? i}
          className="whitespace-pre-wrap"
          style={{ color: LOG_COLOR[e.type] ?? "var(--terminal-ink)" }}
        >
          <span className="mr-2" style={{ opacity: 0.45, fontVariantNumeric: "tabular-nums" }}>
            {new Date(e.ts).toLocaleTimeString("ko-KR", { hour12: false })}
          </span>
          {e.text}
        </p>
      ))}
    </div>
  );
}
