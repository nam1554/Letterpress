"use client";

import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Text,
} from "@mantine/core";

const WIDTHS = [
  { label: "데스크톱 700", value: "700" },
  { label: "태블릿 600", value: "600" },
  { label: "모바일 375", value: "375" },
];

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
    <Button data-testid="copy-html" variant="default" size="compact-sm" onClick={copy}>
      {label}
    </Button>
  );
}

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const file = useSearchParams().get("file") ?? "";
  const [width, setWidth] = useState("700");

  if (!file) {
    return (
      <Container size={680} py={56}>
        <Text size="sm" c="dimmed">
          미리볼 파일이 지정되지 않았습니다.{" "}
          <Anchor href={`/jobs/${id}`}>작업 페이지로 돌아가기</Anchor>
        </Text>
      </Container>
    );
  }

  const src = `/api/jobs/${id}/preview/${file}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Paper
        px="md"
        py={10}
        radius={0}
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap="sm" wrap="nowrap">
          <Anchor href={`/jobs/${id}`} size="sm">
            ← 작업으로
          </Anchor>
          <Text size="xs" c="dimmed" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
            {file}
          </Text>
          <SegmentedControl
            size="xs"
            value={width}
            onChange={setWidth}
            data={WIDTHS}
          />
          <CopyHtmlButton src={src} />
          <Anchor href={src} target="_blank" size="sm">
            원본 열기
          </Anchor>
        </Group>
      </Paper>

      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          overflow: "auto",
          padding: 24,
        }}
      >
        <iframe
          data-testid="preview-frame"
          src={src}
          title="eDM preview"
          style={{
            width: Number(width),
            minHeight: "100%",
            background: "#fff",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 10,
            transition: "width 200ms ease",
          }}
        />
      </div>
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
