"use client";

import { useRef, useState } from "react";
import {
  Anchor,
  Button,
  Collapse,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { formatSize } from "../../lib/format";

export interface Artifact {
  rel: string;
  size: number;
}

interface EmailCheck {
  name: string;
  level: "ok" | "warn" | "fail";
  detail: string;
}

const LEVEL: Record<EmailCheck["level"], { color: string; icon: string }> = {
  ok: { color: "green", icon: "✓" },
  warn: { color: "yellow", icon: "△" },
  fail: { color: "red", icon: "✗" },
};

/** 산출물 목록 + zip 다운로드 + 파일별 발송 전 검사. */
export default function ArtifactList({
  jobId,
  artifacts,
  running,
}: {
  jobId: string;
  artifacts: Artifact[];
  running: boolean;
}) {
  const [checkFor, setCheckFor] = useState<string | null>(null);
  const [checks, setChecks] = useState<EmailCheck[] | null>(null);
  // 다른 파일로 전환한 뒤 도착한 이전 요청의 응답이 덮어쓰지 않도록 최신 대상 추적.
  const latestCheck = useRef<string | null>(null);

  async function toggleCheck(rel: string) {
    if (checkFor === rel) {
      setCheckFor(null);
      latestCheck.current = null;
      return;
    }
    setCheckFor(rel);
    setChecks(null);
    latestCheck.current = rel;
    const res = await fetch(`/api/jobs/${jobId}/check?file=${encodeURIComponent(rel)}`);
    const result: EmailCheck[] = res.ok
      ? (await res.json()).checks
      : [{ name: "검사", level: "fail", detail: "검사 실패" }];
    if (latestCheck.current !== rel) return; // 그 사이 다른 파일로 전환됨
    setChecks(result);
  }

  return (
    <>
      <Group justify="space-between" mt={36} mb="sm">
        <Title order={2} size="h4">
          산출물 ({artifacts.length})
        </Title>
        {artifacts.length > 0 && (
          <Button data-testid="download-zip" component="a" href={`/api/jobs/${jobId}/download`}>
            전체 zip 다운로드
          </Button>
        )}
      </Group>
      <Paper withBorder>
        {artifacts.length === 0 && (
          <Text size="sm" c="dimmed" p="lg">
            {running ? "작업이 끝나면 여기에 파일이 나타납니다." : "산출물이 없습니다."}
          </Text>
        )}
        {artifacts.map((a, i) => (
          <div key={a.rel}>
            {i > 0 && <Divider />}
            <Group px="lg" py={10} gap="sm" wrap="nowrap">
              <Text size="sm" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
                {a.rel}
              </Text>
              <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatSize(a.size)}
              </Text>
              {a.rel.endsWith(".html") && (
                <>
                  <Anchor
                    component="button"
                    size="xs"
                    fw={500}
                    data-testid={`check-${a.rel}`}
                    onClick={() => toggleCheck(a.rel)}
                  >
                    {checkFor === a.rel ? "검사 닫기" : "검사"}
                  </Anchor>
                  <Anchor
                    size="xs"
                    fw={500}
                    href={`/jobs/${jobId}/view?file=${encodeURIComponent(a.rel)}`}
                    target="_blank"
                  >
                    미리보기
                  </Anchor>
                </>
              )}
              <Anchor
                size="xs"
                fw={500}
                href={`/api/jobs/${jobId}/download?file=${encodeURIComponent(a.rel)}`}
              >
                다운로드
              </Anchor>
            </Group>
            <Collapse expanded={checkFor === a.rel}>
              <Stack gap={6} px="lg" pb="md" pt={4} data-testid="check-results">
                {checkFor === a.rel && !checks && (
                  <Group gap="xs">
                    <Loader size="xs" />
                    <Text size="xs" c="dimmed">
                      검사 중…
                    </Text>
                  </Group>
                )}
                {checkFor === a.rel &&
                  checks?.map((c) => (
                    <Group key={c.name} gap="xs" wrap="nowrap" align="flex-start">
                      <ThemeIcon size="xs" variant="light" color={LEVEL[c.level].color} radius="xl">
                        <Text size="xs">{LEVEL[c.level].icon}</Text>
                      </ThemeIcon>
                      <Text size="xs">
                        <b>{c.name}</b>{" "}
                        <Text component="span" c="dimmed">
                          {c.detail}
                        </Text>
                      </Text>
                    </Group>
                  ))}
              </Stack>
            </Collapse>
          </div>
        ))}
      </Paper>
    </>
  );
}
