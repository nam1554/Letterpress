"use client";

import { useEffect, useRef } from "react";
import { Text } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface AgentEvent {
  ts: number;
  type: string;
  text: string;
  seq?: number;
}

// 웜 터미널 서피스에 맞춘 로그 색 (클로드 스타일 테라코타 액센트).
const LOG_COLOR: Record<string, string> = {
  status: "#e0a382",
  tool: "#8a867a",
  error: "#f28b82",
  done: "#a5c496",
  log: "var(--terminal-ink)",
};

/**
 * 상시 다크 터미널 서피스의 진행 로그 뷰어.
 * 긴 변환 로그(수백~수천 이벤트)에서도 보이는 줄만 렌더하도록
 * @tanstack/react-virtual 로 가상화 (자동 스크롤 유지).
 */
export default function LogViewer({ events }: { events: AgentEvent[] }) {
  const viewport = useRef<HTMLDivElement>(null);

  // TanStack Virtual은 내부적으로 가변 인스턴스를 쓰는 설계라 React Compiler
  // 최적화 대상에서 제외해도 무방하다 (공식 권장 사용 패턴 그대로).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 22,
    overscan: 24,
  });

  useEffect(() => {
    if (events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: "end" });
    }
  }, [events.length, virtualizer]);

  return (
    <div
      ref={viewport}
      data-testid="log"
      style={{
        height: 288,
        overflowY: "auto",
        marginTop: 8,
        background: "var(--terminal-bg)",
        color: "var(--terminal-ink)",
        borderRadius: "var(--mantine-radius-md)",
        padding: "var(--mantine-spacing-md)",
      }}
    >
      {events.length === 0 && (
        <Text size="xs" ff="monospace" style={{ opacity: 0.5 }}>
          이벤트 대기 중…
        </Text>
      )}
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const e = events[row.index];
          return (
            <div
              key={e.seq ?? row.index}
              ref={virtualizer.measureElement}
              data-index={row.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            >
              <Text
                size="xs"
                ff="monospace"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.7,
                  color: LOG_COLOR[e.type] ?? "var(--terminal-ink)",
                }}
              >
                <Text
                  component="span"
                  mr={8}
                  style={{ opacity: 0.45, fontVariantNumeric: "tabular-nums" }}
                >
                  {new Date(e.ts).toLocaleTimeString("ko-KR", { hour12: false })}
                </Text>
                {e.text}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
