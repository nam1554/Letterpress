"use client";

import Link from "next/link";
import { Container, Group, Text } from "@mantine/core";
import { PAGE_WIDTH } from "../lib/dimensions";

/**
 * 상단 고정 헤더.
 *
 * 이전엔 페이지 크롬이 전혀 없었다 — 제목이 여백 위에 그냥 떠 있어서 화면을
 * 잡아주는 게 아무것도 없었다. full-bleed 바 + hairline 하나로 페이지에 위아래
 * 기준선을 준다. 스크롤해도 남아 있어야 현재 위치(어느 작업인지)를 잃지 않는다.
 */
export default function AppHeader({
  breadcrumb,
  right,
}: {
  /** 워드마크 뒤에 붙는 현재 위치 (예: 작업 id) */
  breadcrumb?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        borderBottom: "1px solid var(--mantine-color-default-border)",
        // 반투명 + blur: 아래 콘텐츠가 헤더를 뚫고 지나가는 것처럼 보이지 않게.
        background: "color-mix(in srgb, var(--page-bg) 88%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Container size={PAGE_WIDTH} py={12}>
        <Group justify="space-between" wrap="nowrap" gap="md">
          <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text
              component={Link}
              href="/"
              fw={600}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-serif), Georgia, serif",
                fontSize: 15,
                letterSpacing: "-0.01em",
                color: "var(--mantine-color-text)",
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              <Mark />
              Letterpress
            </Text>
            {breadcrumb && (
              <>
                <Text c="dimmed" size="sm" style={{ flexShrink: 0 }} aria-hidden>
                  /
                </Text>
                <div style={{ minWidth: 0 }}>{breadcrumb}</div>
              </>
            )}
          </Group>
          {right && (
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              {right}
            </Group>
          )}
        </Group>
      </Container>
    </header>
  );
}

/**
 * 워드마크. 활자 하나를 조판대에 앉힌 모양 — 이 도구가 하는 일(디자인을 찍어
 * 내는 것)을 그대로 가져왔다. 화면에서 액센트색을 쓰는 유일한 장식이다.
 */
function Mark() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2.5"
        fill="var(--mantine-color-clay-filled)"
      />
      <path
        d="M5.6 4.4h4.8M8 4.4v7.2M6.3 11.6h3.4"
        stroke="var(--mantine-color-white)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
