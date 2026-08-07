"use client";

import { Text } from "@mantine/core";
import { statusMeta } from "../lib/status";

/**
 * 잡 상태의 유일한 표현 — 점 + 라벨.
 *
 * 이전엔 같은 정보가 화면마다 다른 옷을 입고 있었다: 홈 히스토리는 초록 알약
 * 배지, 작업 상세 헤더는 큰 배지, 로그는 또 다른 색. 게다가 Mantine 기본
 * 고채도 색이라 한 줄에 초록 배지 + 테라코타 링크 + 핫핑크 삭제가 함께 있었다.
 * 여기서 하나로 묶어 헤더·행·어디서든 같게 읽히게 한다.
 *
 * 색은 `--mantine-color-{c}-light-color` 하나로 통일한다 — 스킴을 아는 변수라
 * 컴포넌트가 테마를 분기하지 않고(AGENTS.md 규칙), 라이트에선 어두운 shade,
 * 다크에선 밝은 shade로 알아서 뒤집힌다. `-filled`는 primaryShade(7)를 따라가서
 * 다크 카드 위에서 대비 1.9로 거의 안 보였다 — 점은 라벨 색을 그대로 상속한다.
 */
export default function StatusDot({
  status,
  size = "sm",
  testId,
}: {
  status: string;
  /** sm = 목록 행, lg = 페이지 헤더 */
  size?: "sm" | "lg";
  testId?: string;
}) {
  const { color, label } = statusMeta(status);
  const dot = size === "lg" ? 8 : 6;

  return (
    <Text
      component="span"
      data-testid={testId}
      size={size === "lg" ? "sm" : "xs"}
      fw={500}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size === "lg" ? 7 : 6,
        whiteSpace: "nowrap",
        color: `var(--mantine-color-${color}-light-color)`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: dot,
          height: dot,
          borderRadius: "50%",
          flexShrink: 0,
          background: "currentColor",
          // 실행 중만 살아 있다는 신호를 준다. keyframes(mhm-pulse)와
          // prefers-reduced-motion 처리는 globals.css에 있다.
          animation: status === "running" ? "mhm-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </Text>
  );
}
