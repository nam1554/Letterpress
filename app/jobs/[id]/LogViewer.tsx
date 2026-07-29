"use client";

import { useEffect, useRef } from "react";
import { ScrollArea, Text } from "@mantine/core";

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

/** 상시 다크 터미널 서피스의 진행 로그 뷰어 (자동 스크롤). */
export default function LogViewer({ events }: { events: AgentEvent[] }) {
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [events]);

  return (
    <ScrollArea
      h={288}
      viewportRef={viewport}
      data-testid="log"
      mt={8}
      style={{
        background: "var(--terminal-bg)",
        color: "var(--terminal-ink)",
        borderRadius: "var(--mantine-radius-md)",
      }}
      p="md"
    >
      {events.length === 0 && (
        <Text size="xs" ff="monospace" style={{ opacity: 0.5 }}>
          이벤트 대기 중…
        </Text>
      )}
      {events.map((e, i) => (
        <Text
          key={e.seq ?? i}
          size="xs"
          ff="monospace"
          style={{
            whiteSpace: "pre-wrap",
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
      ))}
    </ScrollArea>
  );
}
