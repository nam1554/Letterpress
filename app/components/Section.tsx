"use client";

import { useId, useState } from "react";
import { Collapse, Group, Paper, Text, Title, UnstyledButton } from "@mantine/core";

/**
 * 모든 섹션의 단일 컨테이너.
 *
 * 왜 필요한가: 작업 상세 화면이 섹션 제목을 네 가지 방식으로 쓰고 있었다 —
 * 12px dimmed 라벨(`진행 로그`), 세리프 헤딩(`산출물`), Accordion(`픽셀 검증`),
 * 카드 안 볼드 타이틀(`발송 준비`). `부분 수정`은 카드도 없이 맨몸으로 카드 두
 * 개 사이에 있었다. 같은 위계의 것이 매번 다르게 보이는 게 "어색함"의 큰 축이라
 * 하나로 통일한다.
 *
 * - `right` 슬롯: 배지·상태·액션 버튼. 헤더 오른쪽에 정렬된다.
 * - `flush`: 본문 패딩 제거 — 행이 카드 끝까지 가는 목록/표에 쓴다.
 * - `collapsible`: 헤더 전체가 토글 버튼이 된다 (설정·백엔드 연동처럼 기본
 *   접혀 있어야 하는 섹션). Accordion을 쓰면 또 다른 헤더 모양이 생기므로
 *   같은 헤더를 유지한 채 접힘만 붙였다.
 */
export default function Section({
  title,
  subtitle,
  right,
  icon,
  children,
  flush = false,
  collapsible = false,
  defaultOpen = false,
  testId,
  controlTestId,
  mt = "lg",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
  controlTestId?: string;
  mt?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  // aria-expanded만 있으면 "무엇이" 펼쳐지는지 보조기술이 알 수 없다 —
  // 토글과 본문을 aria-controls로 묶는다.
  const bodyId = `${useId()}-body`;

  const heading = (
    <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      {icon && (
        <Text component="span" c="dimmed" style={{ display: "flex" }}>
          {icon}
        </Text>
      )}
      <div style={{ minWidth: 0 }}>
        <Title order={2} style={{ letterSpacing: "-0.01em" }}>
          {title}
        </Title>
        {subtitle && (
          <Text size="xs" c="dimmed" mt={2}>
            {subtitle}
          </Text>
        )}
      </div>
    </Group>
  );

  const header = (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="md"
      px="lg"
      py="md"
      // 접힌 섹션은 헤더만 남으므로 아래 hairline이 필요 없다.
      style={
        expanded
          ? { borderBottom: "1px solid var(--mantine-color-default-border)" }
          : undefined
      }
    >
      {collapsible ? (
        // flex:1을 주지 않는다 — 주면 셰브론이 헤더를 가로질러 right 슬롯 옆까지
        // 밀려나 어느 쪽에 속한 컨트롤인지 읽히지 않는다. 제목에 붙여 둔다.
        <UnstyledButton
          data-testid={controlTestId}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          style={{ display: "flex", alignItems: "center", minWidth: 0, gap: 8 }}
        >
          {heading}
          <Chevron open={open} />
        </UnstyledButton>
      ) : (
        heading
      )}
      {right && (
        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          {right}
        </Group>
      )}
    </Group>
  );

  return (
    // overflow:hidden — `flush` 본문(목록 행, 터미널 서피스)이 카드 모서리를
    // 넘어가지 않게 잘라낸다. Tooltip·Select 드롭다운은 포털로 렌더되므로
    // 여기서 잘리지 않는다.
    <Paper withBorder mt={mt} data-testid={testId} style={{ overflow: "hidden" }}>
      {header}
      <Collapse expanded={expanded}>
        <div
          id={collapsible ? bodyId : undefined}
          role={collapsible ? "region" : undefined}
          style={flush ? undefined : { padding: "var(--mantine-spacing-lg)" }}
        >
          {children}
        </div>
      </Collapse>
    </Paper>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        flexShrink: 0,
        color: "var(--mantine-color-dimmed)",
        transform: open ? "rotate(180deg)" : undefined,
        transition: "transform 150ms ease",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
