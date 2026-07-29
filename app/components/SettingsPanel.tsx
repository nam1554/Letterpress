"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

interface ProviderInfo {
  id: string;
  label: string;
}
interface SettingsView {
  defaultProvider: string;
  maxConcurrentJobs: number;
  jobTimeoutMinutes: number;
  figmaTokenSet: boolean;
  geminiApiKeySet: boolean;
  providers: ProviderInfo[];
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="xl">
      <div>
        <Text size="sm">{label}</Text>
        <Text size="xs" c="dimmed" maw={360}>
          {hint}
        </Text>
      </div>
      {control}
    </Group>
  );
}

/** 홈 화면의 접이식 설정 패널 — 환경변수 없이 모든 설정을 화면에서. */
export default function SettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [figmaToken, setFigmaToken] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setView)
      .catch(() => {});
  }, []);

  if (!view) return null;

  async function save() {
    if (!view) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        defaultProvider: view.defaultProvider,
        maxConcurrentJobs: view.maxConcurrentJobs,
        jobTimeoutMinutes: view.jobTimeoutMinutes,
      };
      if (figmaToken.trim()) body.figmaToken = figmaToken.trim();
      if (geminiApiKey.trim()) body.geminiApiKey = geminiApiKey.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({ message: data.error ?? "저장 실패", color: "red" });
        return;
      }
      setView(data);
      setFigmaToken("");
      setGeminiApiKey("");
      notifications.show({ message: "설정을 저장했습니다.", color: "teal" });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function clearToken() {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figmaToken: "" }),
    });
    if (res.ok) {
      setView(await res.json());
      notifications.show({ message: "Figma 토큰을 삭제했습니다.", color: "gray" });
    }
  }

  return (
    <Accordion variant="contained" mt="md" chevronPosition="right">
      <Accordion.Item value="settings">
        <Accordion.Control data-testid="settings-toggle">⚙️ 설정</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Row
              label="기본 백엔드"
              hint="새 작업 폼의 기본 선택값"
              control={
                <Select
                  data-testid="setting-provider"
                  value={view.defaultProvider}
                  onChange={(v) => v && setView({ ...view, defaultProvider: v })}
                  data={view.providers.map((p) => ({ value: p.id, label: p.label }))}
                  allowDeselect={false}
                  w={260}
                />
              }
            />
            <Row
              label="동시 실행 작업 수"
              hint="변환 1건이 10~25분 걸립니다. 머신 부하를 고려해 1~3 권장"
              control={
                <NumberInput
                  data-testid="setting-concurrent"
                  min={1}
                  max={5}
                  value={view.maxConcurrentJobs}
                  onChange={(v) => setView({ ...view, maxConcurrentJobs: Number(v) || 1 })}
                  w={100}
                />
              }
            />
            <Row
              label="작업 제한 시간 (분)"
              hint="초과 시 자동 중단"
              control={
                <NumberInput
                  data-testid="setting-timeout"
                  min={5}
                  max={180}
                  value={view.jobTimeoutMinutes}
                  onChange={(v) => setView({ ...view, jobTimeoutMinutes: Number(v) || 45 })}
                  w={100}
                />
              }
            />
            <Row
              label="Figma 토큰 (선택)"
              hint="Figma MCP를 못 쓰는 환경(무료 시트 등)용 REST API 폴백. figma.com → 설정 → Security → Personal access tokens에서 발급해 직접 붙여넣으세요. 이 컴퓨터의 data/settings.json(0600)에만 저장됩니다."
              control={
                <Group gap="xs" wrap="nowrap">
                  {view.figmaTokenSet && !figmaToken && (
                    <>
                      <Text size="xs" c="green">
                        설정됨
                      </Text>
                      <Button variant="subtle" color="red" size="compact-xs" onClick={clearToken}>
                        삭제
                      </Button>
                    </>
                  )}
                  <PasswordInput
                    data-testid="setting-figma-token"
                    value={figmaToken}
                    onChange={(e) => setFigmaToken(e.currentTarget.value)}
                    placeholder={view.figmaTokenSet ? "변경하려면 입력" : "figd_…"}
                    w={180}
                  />
                </Group>
              }
            />
            <Row
              label="Gemini API 키 (선택)"
              hint="Gemini 백엔드용. 구글의 무료 로그인 티어가 중단돼 API 키가 필요합니다 — aistudio.google.com/apikey 에서 발급해 직접 붙여넣으세요. 이 컴퓨터의 data/settings.json(0600)에만 저장됩니다."
              control={
                <Group gap="xs" wrap="nowrap">
                  {view.geminiApiKeySet && !geminiApiKey && (
                    <Text size="xs" c="green">
                      설정됨
                    </Text>
                  )}
                  <PasswordInput
                    data-testid="setting-gemini-key"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.currentTarget.value)}
                    placeholder={view.geminiApiKeySet ? "변경하려면 입력" : "AIza…"}
                    w={180}
                  />
                </Group>
              }
            />
            <Group>
              <Button data-testid="settings-save" onClick={save} loading={saving}>
                저장
              </Button>
            </Group>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
