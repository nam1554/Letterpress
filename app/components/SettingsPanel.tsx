"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import {
  Accordion,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { fetcher } from "../lib/fetcher";
import { sendJson } from "../lib/request";

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
  claudeModel: string;
  notifyOnFinish: boolean;
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
  const { data } = useSWR<SettingsView>("/api/settings", fetcher);
  // 서버 데이터 위에 수정분만 얹는다 — 저장 전까지 SWR 캐시를 오염시키지 않음.
  const [edits, setEdits] = useState<Partial<SettingsView>>({});
  const [figmaToken, setFigmaToken] = useState("");
  const [saving, setSaving] = useState(false);

  if (!data) return null;
  const view = { ...data, ...edits };

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        defaultProvider: view.defaultProvider,
        maxConcurrentJobs: view.maxConcurrentJobs,
        jobTimeoutMinutes: view.jobTimeoutMinutes,
        claudeModel: view.claudeModel,
        notifyOnFinish: view.notifyOnFinish,
      };
      if (figmaToken.trim()) body.figmaToken = figmaToken.trim();
      const r = await sendJson<SettingsView & { warning?: string }>(
        "/api/settings",
        "PUT",
        body,
      );
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      const saved = r.data;
      await mutate("/api/settings", saved, { revalidate: false });
      setEdits({});
      setFigmaToken("");
      notifications.show({
        message: saved.warning ? `저장했습니다 — ${saved.warning}` : "설정을 저장했습니다.",
        color: saved.warning ? "yellow" : "teal",
      });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function clearToken() {
    const r = await sendJson<SettingsView>("/api/settings", "PUT", { figmaToken: "" });
    if (!r.ok) {
      notifications.show({ message: r.error, color: "red" });
      return;
    }
    await mutate("/api/settings", r.data, { revalidate: false });
    notifications.show({ message: "Figma 토큰을 삭제했습니다.", color: "gray" });
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
                  onChange={(v) => v && setEdits((e) => ({ ...e, defaultProvider: v }))}
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
                  onChange={(v) => setEdits((e) => ({ ...e, maxConcurrentJobs: Number(v) || 1 }))}
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
                  onChange={(v) => setEdits((e) => ({ ...e, jobTimeoutMinutes: Number(v) || 45 }))}
                  w={100}
                />
              }
            />
            <Row
              label="Claude 모델 (선택)"
              hint="claude CLI에 --model로 전달됩니다 (예: haiku, sonnet). 비우면 CLI 기본 모델. 저렴한 모델은 검증 반복이 늘어 실패율이 올라갈 수 있지만, 품질 게이트가 미달 결과를 걸러냅니다."
              control={
                <TextInput
                  data-testid="setting-claude-model"
                  value={view.claudeModel}
                  onChange={(e) => {
                    const claudeModel = e.currentTarget.value;
                    setEdits((prev) => ({ ...prev, claudeModel }));
                  }}
                  placeholder="CLI 기본"
                  w={180}
                />
              }
            />
            <Row
              label="완료 알림"
              hint="변환이 끝나면(성공/실패 모두) macOS 알림센터로 알립니다 — 탭을 계속 보고 있지 않아도 됩니다."
              control={
                <Switch
                  data-testid="setting-notify"
                  checked={view.notifyOnFinish}
                  onChange={(e) => {
                    const notifyOnFinish = e.currentTarget.checked;
                    setEdits((prev) => ({ ...prev, notifyOnFinish }));
                  }}
                />
              }
            />
            <Row
              label="Figma 토큰 (선택)"
              hint="Figma MCP를 못 쓰는 환경(무료 시트 등)용 REST API 폴백. figma.com → 설정 → Security → Personal access tokens에서 발급해 직접 붙여넣으세요. 저장 시 즉시 검증되며, 이 컴퓨터의 data/settings.json(0600)에만 저장됩니다."
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
