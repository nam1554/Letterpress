"use client";

import { Anchor, Badge, Group, Image, Stack, Text } from "@mantine/core";
import Section from "../../components/Section";

export interface VerifySummary {
  result: "PASS" | "FAIL";
  overall?: number;
  heightDelta?: number;
}

const LABELS: Record<string, string> = {
  side_by_side: "Figma ↔ 렌더 비교",
  diff_heat: "차이 히트맵",
  figma_full: "Figma 원본 캡처",
  my_full: "HTML 렌더 캡처",
};

/**
 * 픽셀 검증 리포트 — PASS/FAIL 판정 + 파이프라인이 남긴 비교 이미지.
 *
 * 예전엔 Mantine Accordion이라 같은 화면에서 유일하게 다른 헤더 모양을 갖고
 * 있었다. 접힘은 유지하되 헤더는 다른 섹션과 같은 `Section`을 쓴다.
 */
export default function VerifyReport({
  jobId,
  files,
  verify,
}: {
  jobId: string;
  files: string[];
  verify?: VerifySummary | null;
}) {
  if (files.length === 0 && !verify) return null;

  const isInline = (f: string) => f === "side_by_side.png" || f === "diff_heat.png";
  const inline = files.filter(isInline);
  const linksOnly = files.filter((f) => !isInline(f));
  const url = (f: string) => `/api/jobs/${jobId}/verify/${f}`;

  return (
    <Section
      title="픽셀 검증"
      collapsible
      controlTestId="verify-toggle"
      right={
        verify ? (
          <Badge
            data-testid="verify-result"
            color={verify.result === "PASS" ? "green" : "red"}
            variant="light"
          >
            {verify.result}
            {verify.overall !== undefined ? ` · ${verify.overall}%` : ""}
          </Badge>
        ) : undefined
      }
    >
      <Stack gap="lg">
        {inline.map((f) => (
          <figure key={f} style={{ margin: 0 }}>
            <Text size="xs" fw={600} c="dimmed" mb={8} component="figcaption">
              {LABELS[f.replace(".png", "")] ?? f}
            </Text>
            <Anchor href={url(f)} target="_blank">
              <Image
                src={url(f)}
                alt={f}
                radius="md"
                style={{ border: "1px solid var(--mantine-color-default-border)" }}
              />
            </Anchor>
          </figure>
        ))}
        {linksOnly.length > 0 && (
          <Group gap="md">
            <Text size="xs" c="dimmed">
              원본 캡처
            </Text>
            {linksOnly.map((f) => (
              <Anchor key={f} href={url(f)} target="_blank" size="xs">
                {LABELS[f.replace(".png", "")] ?? f}
              </Anchor>
            ))}
          </Group>
        )}
      </Stack>
    </Section>
  );
}
