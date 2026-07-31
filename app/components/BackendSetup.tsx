"use client";

import { useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { sendJson } from "../lib/request";
import Section from "./Section";
import { IconCheck, IconPlug, IconQuestion, IconX } from "./icons";

export interface SetupStep {
  name: string;
  ok: boolean | null;
  detail: string;
  hint?: string;
  command?: string;
}
export interface BackendInfo {
  id: string;
  label: string;
  ready: boolean;
  steps: SetupStep[];
}

interface TestResult {
  ok: boolean;
  summary: string;
  ms: number;
}

const SHORT_NAME: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
};

/**
 * 진단 단계 상태 아이콘. 예전엔 ThemeIcon 원형 배지 + 이모지 글리프였다 —
 * 목록 왼쪽에 색 동그라미가 줄줄이 서서 실제 텍스트보다 시선을 끌었다.
 * 아이콘만 남기고 색으로 상태를 전달한다.
 */
function StepIcon({ ok }: { ok: boolean | null }) {
  const color =
    ok === true
      ? "var(--mantine-color-green-light-color)"
      : ok === false
        ? "var(--mantine-color-red-light-color)"
        : "var(--mantine-color-dimmed)";
  return (
    <Text component="span" style={{ display: "flex", color, marginTop: 2 }}>
      {ok === true ? (
        <IconCheck size={13} label="통과" />
      ) : ok === false ? (
        <IconX size={13} label="실패" />
      ) : (
        <IconQuestion size={13} label="확인 안 됨" />
      )}
    </Text>
  );
}

function CommandChip({ command }: { command: string }) {
  return (
    <Group gap={6} mt={4} wrap="nowrap">
      <Code style={{ fontSize: 11, overflowX: "auto" }}>{command}</Code>
      <CopyButton value={command}>
        {({ copied, copy }) => (
          <Button size="compact-xs" variant="subtle" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}

/**
 * 백엔드별 연동 카드 — 설치→인증→Figma 접근 단계 진단, 해결 명령 복사,
 * 실제 CLI를 스폰하는 연동 테스트까지 한 곳에서.
 */
export default function BackendSetup({
  backends,
  onRefresh,
}: {
  backends: BackendInfo[] | null;
  onRefresh: (force?: boolean) => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const needsSetup = backends?.filter((b) => !b.ready) ?? [];

  async function runTest(id: string) {
    setTesting(id);
    try {
      const r = await sendJson<TestResult>("/api/setup/test", "POST", { provider: id });
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      const data = r.data;
      setResults((prev) => ({ ...prev, [id]: data }));
      notifications.show({
        message: data.ok
          ? `${SHORT_NAME[id] ?? id} 연동 테스트 통과 (${Math.round(data.ms / 1000)}초)`
          : `${SHORT_NAME[id] ?? id} 연동 테스트 실패`,
        color: data.ok ? "teal" : "red",
      });
    } finally {
      setTesting(null);
    }
  }

  return (
    <Section
      title="백엔드 연동"
      icon={<IconPlug size={15} />}
      collapsible
      controlTestId="backend-setup-toggle"
      right={
        <>
          {backends === null && <Loader size={14} />}
          {backends !== null && backends.length === 0 && (
            <Badge size="sm" variant="light" color="gray">
              상태 확인 실패
            </Badge>
          )}
          {backends !== null &&
            backends.length > 0 &&
            (needsSetup.length === 0 ? (
              <Badge size="sm" variant="light" color="green">
                모두 준비됨
              </Badge>
            ) : (
              needsSetup.map((b) => (
                <Badge key={b.id} size="sm" variant="light" color="yellow">
                  {SHORT_NAME[b.id] ?? b.id} 설정 필요
                </Badge>
              ))
            ))}
        </>
      }
    >
      {backends === null ? (
        <Group gap="xs" p="sm">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            CLI 설치·인증·Figma 연결을 점검하는 중입니다 (최대 1분)…
          </Text>
        </Group>
      ) : (
        <Stack gap="sm">
          {backends.length === 0 && (
            <Text size="xs" c="dimmed">
              연동 상태를 불러오지 못했습니다 — 아래 &quot;다시 점검&quot;으로 재시도하세요.
            </Text>
          )}
          {backends.map((b) => {
            const result = results[b.id];
            return (
              <Paper key={b.id} withBorder p="md" radius="md" data-testid={`backend-${b.id}`}>
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {b.label}
                    </Text>
                    <Badge size="sm" variant="light" color={b.ready ? "green" : "yellow"}>
                      {b.ready ? "사용 가능" : "설정 필요"}
                    </Badge>
                  </Group>
                  {b.id !== "mock" && (
                    <Button
                      data-testid={`test-${b.id}`}
                      size="compact-xs"
                      variant="light"
                      loading={testing === b.id}
                      disabled={testing !== null && testing !== b.id}
                      onClick={() => runTest(b.id)}
                    >
                      연동 테스트
                    </Button>
                  )}
                </Group>
                <Stack gap={8} mt="sm">
                  {b.steps.map((s) => (
                    <Group key={s.name} gap="xs" align="flex-start" wrap="nowrap">
                      <StepIcon ok={s.ok} />
                      <div style={{ minWidth: 0 }}>
                        <Text size="xs">
                          <Text component="span" fw={600}>
                            {s.name}
                          </Text>{" "}
                          — {s.detail}
                        </Text>
                        {s.ok === false && s.hint && (
                          <Text size="xs" c="dimmed">
                            {s.hint}
                          </Text>
                        )}
                        {s.ok === false && s.command && <CommandChip command={s.command} />}
                      </div>
                    </Group>
                  ))}
                </Stack>
                {result && (
                  <Alert
                    mt="sm"
                    p="xs"
                    variant="light"
                    color={result.ok ? "green" : "red"}
                    data-testid={`test-result-${b.id}`}
                  >
                    <Text size="xs">
                      {result.ok
                        ? `실제 CLI 왕복 확인 완료 (${Math.round(result.ms / 1000)}초) — 이 백엔드로 변환을 실행할 수 있습니다.`
                        : `테스트 실패: ${result.summary}`}
                    </Text>
                  </Alert>
                )}
              </Paper>
            );
          })}
      <Group justify="space-between" gap="md" wrap="nowrap" align="baseline">
        <Text size="xs" c="dimmed">
          연동 테스트는 초소형 프롬프트를 실제로 실행합니다 (토큰 소량 소모, 최대 2분).
        </Text>
        <Anchor
          component="button"
          type="button"
          size="xs"
          onClick={() => onRefresh(true)}
              data-testid="setup-recheck"
              style={{ flexShrink: 0 }}
            >
              다시 점검
            </Anchor>
          </Group>
        </Stack>
      )}
    </Section>
  );
}
