"use client";

import { useState } from "react";
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

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
  gemini: "Gemini",
  codex: "Codex",
};

function StepIcon({ ok }: { ok: boolean | null }) {
  return (
    <ThemeIcon
      size="xs"
      radius="xl"
      variant="light"
      color={ok === true ? "green" : ok === false ? "red" : "gray"}
    >
      <Text size="9px" fw={700} lh={1}>
        {ok === true ? "✓" : ok === false ? "✕" : "?"}
      </Text>
    </ThemeIcon>
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

/** Gemini API 키 입력 — 카드 안에서 바로 저장·검증한다. */
function GeminiKeyInput({ keySet, onSaved }: { keySet: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey: value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({ message: data.error ?? "저장 실패", color: "red" });
        return;
      }
      setValue("");
      notifications.show({
        message: data.warning
          ? `키를 저장했습니다 — ${data.warning}`
          : "Gemini API 키를 검증하고 저장했습니다.",
        color: data.warning ? "yellow" : "teal",
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Group gap="xs" mt="sm" wrap="nowrap">
      <PasswordInput
        data-testid="gemini-key-input"
        size="xs"
        w={220}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder={keySet ? "변경하려면 새 키 입력" : "AIza… (aistudio.google.com/apikey)"}
      />
      <Button size="compact-sm" variant="light" onClick={save} loading={saving} disabled={!value.trim()}>
        키 저장
      </Button>
      {keySet && !value && (
        <Text size="xs" c="green">
          설정됨
        </Text>
      )}
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
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({ message: data.error ?? "테스트 실행 실패", color: "red" });
        return;
      }
      setResults((r) => ({ ...r, [id]: data }));
      notifications.show({
        message: data.ok
          ? `${SHORT_NAME[id] ?? id} 연동 테스트 통과 (${Math.round(data.ms / 1000)}초)`
          : `${SHORT_NAME[id] ?? id} 연동 테스트 실패`,
        color: data.ok ? "teal" : "red",
      });
    } catch {
      notifications.show({ message: "테스트 요청에 실패했습니다.", color: "red" });
    } finally {
      setTesting(null);
    }
  }

  return (
    <Accordion variant="contained" mt="md" chevronPosition="right">
      <Accordion.Item value="backends">
        <Accordion.Control data-testid="backend-setup-toggle">
          <Group gap="xs" wrap="nowrap">
            <Text size="sm">🔌 백엔드 연동</Text>
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
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
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
                    {b.id === "gemini" && (
                      <GeminiKeyInput
                        keySet={b.steps.some((s) => s.name === "API 키" && s.ok === true)}
                        onSaved={() => onRefresh(true)}
                      />
                    )}
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
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  연동 테스트는 초소형 프롬프트를 실제로 실행합니다 (토큰 소량 소모, 최대 2분).
                </Text>
                <Anchor component="button" size="xs" onClick={() => onRefresh(true)} data-testid="setup-recheck">
                  다시 점검
                </Anchor>
              </Group>
            </Stack>
          )}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
