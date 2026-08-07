"use client";

import { useRef, useState } from "react";
import { Anchor, Collapse, Group, Loader, Stack, Text } from "@mantine/core";
import { formatSize } from "../../lib/format";
import { requestJson } from "../../lib/request";
import { IconAlert, IconCheck, IconX } from "../../components/icons";
import type { EmailCheck } from "@/lib/email-check";
import type { Artifact } from "@/lib/jobs/store";
export type { Artifact };

/** 검사 결과 아이콘 — 이모지 대신 인라인 SVG, 색은 테마 상태색을 따른다. */
function CheckIcon({ level }: { level: EmailCheck["level"] }) {
  const color =
    level === "ok"
      ? "var(--mantine-color-green-light-color)"
      : level === "warn"
        ? "var(--mantine-color-yellow-light-color)"
        : "var(--mantine-color-red-light-color)";
  return (
    <Text component="span" style={{ display: "flex", color, marginTop: 2 }}>
      {level === "ok" ? (
        <IconCheck size={13} />
      ) : level === "warn" ? (
        <IconAlert size={13} />
      ) : (
        <IconX size={13} />
      )}
    </Text>
  );
}

/**
 * 산출물 목록 + 파일별 발송 전 검사.
 *
 * 제목과 "전체 zip" 버튼은 감싸는 `Section`이 담당한다 — 예전엔 이 컴포넌트가
 * 자기 헤딩(`Title order={2}`)을 들고 있어서 같은 화면의 다른 섹션들과 헤더
 * 모양이 어긋났다.
 */
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
    const r = await requestJson<{ checks: EmailCheck[] }>(
      `/api/jobs/${jobId}/check?file=${encodeURIComponent(rel)}`,
    );
    const result: EmailCheck[] = r.ok
      ? r.data.checks
      : [{ name: "검사", level: "fail", detail: r.error }];
    if (latestCheck.current !== rel) return; // 그 사이 다른 파일로 전환됨
    setChecks(result);
  }

  if (artifacts.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="lg">
        {running ? "작업이 끝나면 여기에 파일이 나타납니다." : "산출물이 없습니다."}
      </Text>
    );
  }

  return (
    <>
      {artifacts.map((a, i) => (
        <div
          key={a.rel}
          style={{
            borderTop: i > 0 ? "1px solid var(--mantine-color-default-border)" : undefined,
          }}
        >
          <Group px="lg" py={10} gap="md" wrap="nowrap">
            <Text size="sm" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
              {a.rel}
            </Text>
            <Text
              size="xs"
              c="dimmed"
              w={64}
              ta="right"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatSize(a.size)}
            </Text>
            {/* 액션 열 폭을 고정해 행마다 링크가 다른 위치에 놓이지 않게 한다. */}
            <Group gap="md" w={168} justify="flex-end" wrap="nowrap">
              {a.rel.endsWith(".html") && (
                <>
                  <Anchor
                    component="button"
                    type="button"
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
          </Group>
          <Collapse expanded={checkFor === a.rel}>
            <Stack gap={8} px="lg" pb="md" pt={2} data-testid="check-results">
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
                    <CheckIcon level={c.level} />
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
    </>
  );
}
