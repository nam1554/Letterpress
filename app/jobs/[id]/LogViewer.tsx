"use client";

import { useEffect, useRef } from "react";
import { Text } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatLogLine, type LogSegment } from "../../lib/log-format";
import type { AgentEvent } from "@/lib/providers/types";
export type { AgentEvent };

/**
 * 웜 터미널 서피스에 맞춘 로그 색. 테마의 저채도 어스톤 팔레트에서 다크 서피스용
 * shade(3~4)를 가져와, 화면 나머지와 같은 팔레트로 읽히게 한다. 예전 error 색
 * (#f28b82)은 Mantine 기본 계열의 고채도 살몬이라 여기서만 튀었다.
 */
const LOG_COLOR: Record<string, string> = {
  status: "#D8A583", // clay.4
  tool: "#948D7D", // warm gray.5
  error: "#D08E7F", // oxblood.3
  done: "#ADBE93", // sage.3
  log: "var(--terminal-ink)",
};

/** 세그먼트별 강조색. 줄 색(LOG_COLOR)을 덮어써 종류를 구분한다. */
const CODE_INK = "#E2BEA4"; // clay.2 — 백틱이었던 것
const MUTED_INK = "#8F8B7E"; // 경로·URL — 줄의 본문보다 한 단계 물러난다

/**
 * 세그먼트 하나를 그린다. 경로·링크는 `title`에 원본 전체 경로를 달아 두므로
 * 줄여 보여도 정보가 사라지지 않는다 (마우스를 올리면 전체가 보인다).
 */
function Seg({ seg }: { seg: LogSegment }) {
  const weight = seg.strong ? 600 : undefined;

  if (seg.kind === "code") {
    return (
      <span style={{ color: CODE_INK, fontWeight: weight }}>{seg.text}</span>
    );
  }
  if (seg.kind === "path") {
    return (
      <span title={seg.full} style={{ color: MUTED_INK, fontWeight: weight }}>
        {seg.text}
      </span>
    );
  }
  if (seg.kind === "url") {
    return <span style={{ color: MUTED_INK, fontWeight: weight }}>{seg.text}</span>;
  }
  if (seg.kind === "link") {
    return (
      <span title={seg.full} style={{ fontWeight: weight }}>
        {seg.text}
        <span style={{ color: MUTED_INK }}> ({seg.target})</span>
      </span>
    );
  }
  return <span style={{ fontWeight: weight }}>{seg.text}</span>;
}

/**
 * 줄 파싱 결과는 **이벤트 객체별로** 캐시한다. SSE append마다 events는 새 배열이
 * 되므로 배열 단위 useMemo는 줄 하나가 도착할 때마다 전체를 다시 파싱했다 —
 * 잡 수명 동안의 총비용이 이벤트 수에 대해 제곱으로 늘어난다(수천 이벤트 잡).
 * 이벤트 객체 자체는 재사용되니 WeakMap이면 줄당 정확히 한 번만 파싱하고,
 * 배열이 버려질 때 함께 수거된다.
 */
const parsedLines = new WeakMap<AgentEvent, LogSegment[]>();

function segmentsOf(event: AgentEvent): LogSegment[] {
  let segments = parsedLines.get(event);
  if (!segments) {
    segments = formatLogLine(event.text);
    parsedLines.set(event, segments);
  }
  return segments;
}

/**
 * 상시 다크 터미널 서피스의 진행 로그 뷰어.
 * 긴 변환 로그(수백~수천 이벤트)에서도 보이는 줄만 렌더하도록
 * @tanstack/react-virtual 로 가상화 (자동 스크롤 유지).
 */
export default function LogViewer({ events }: { events: AgentEvent[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  // 사용자가 위로 스크롤해 읽는 중엔 자동 스크롤로 끌어내리지 않는다 —
  // 바닥 근처(40px)에 있을 때만 새 이벤트를 따라간다.
  const stickToBottom = useRef(true);

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
    if (events.length > 0 && stickToBottom.current) {
      virtualizer.scrollToIndex(events.length - 1, { align: "end" });
    }
  }, [events.length, virtualizer]);

  return (
    <div
      ref={viewport}
      data-testid="log"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      style={{
        height: 320,
        overflowY: "auto",
        // Section이 flush로 렌더하고 모서리를 잘라내므로 여기서 radius·margin을
        // 갖지 않는다 — 터미널이 카드 안쪽 폭을 그대로 채운다.
        background: "var(--terminal-bg)",
        color: "var(--terminal-ink)",
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
                {segmentsOf(e).map((seg, i) => <Seg key={i} seg={seg} />)}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
