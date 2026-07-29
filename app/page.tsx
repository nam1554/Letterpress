"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import SettingsPanel from "./components/SettingsPanel";
import { parseFigmaUrl } from "@/lib/figma";
import { figmaLabel, relativeTime } from "./lib/format";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
  provider: string;
  status: string;
  createdAt: number;
  summary?: string;
}
interface ProviderInfo {
  id: string;
  label: string;
}
interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
  optional?: boolean;
}

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  queued: { color: "gray", label: "대기" },
  running: { color: "blue", label: "실행 중" },
  succeeded: { color: "green", label: "완료" },
  failed: { color: "red", label: "실패" },
};

export default function Home() {
  const router = useRouter();
  const [figmaUrl, setFigmaUrl] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState<HealthCheck[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const parsed = useMemo(
    () => (figmaUrl.trim() ? parseFigmaUrl(figmaUrl) : undefined),
    [figmaUrl],
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs);
    setProviders(data.providers);
    setProvider((p) => p || data.defaultProvider);
  }, []);

  useEffect(() => {
    // load()는 async — setState는 fetch 완료 후 콜백에서 일어난다 (lint false positive)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d.checks))
      .catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function recheckHealth() {
    setHealth(null);
    try {
      const res = await fetch("/api/health?force=1");
      setHealth((await res.json()).checks);
    } catch {
      /* 표시 유지 */
    }
  }

  async function createAndGo(url: string, providerId: string) {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl: url, provider: providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "요청 실패");
        return;
      }
      router.push(`/jobs/${data.job.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (provider) await createAndGo(figmaUrl, provider);
  }

  async function removeJob(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (res.ok) {
      notifications.show({ message: "작업을 삭제했습니다.", color: "gray" });
      void load();
    } else setError((await res.json()).error ?? "삭제 실패");
  }

  async function clearHistory() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const res = await fetch("/api/jobs", { method: "DELETE" });
    if (res.ok) {
      const { deleted } = await res.json();
      notifications.show({ message: `완료된 작업 ${deleted}건을 삭제했습니다.`, color: "gray" });
      void load();
    } else setError("일괄 삭제 실패");
  }

  const requiredFails = health?.filter((c) => !c.ok && !c.optional) ?? [];
  const optionalFails = health?.filter((c) => !c.ok && c.optional) ?? [];

  return (
    <Container size={680} py={56}>
      <Group align="baseline" gap="sm">
        <Title order={1} size={28}>
          Marketing HTML Maker
        </Title>
        <Text c="dimmed" size="sm">
          Figma → eDM HTML
        </Text>
      </Group>
      <Text c="dimmed" size="sm" mt={6}>
        Figma 디자인 링크를 붙여넣으면 에이전트가 픽셀 검증까지 마친 이메일
        HTML을 만들어 드립니다. 완료 후 HTML + 이미지 폴더를 zip으로 받으세요.
      </Text>

      {requiredFails.length > 0 && (
        <Alert
          data-testid="health-banner"
          color="yellow"
          variant="light"
          mt="lg"
          title="환경 점검이 필요합니다 — 변환이 실패할 수 있어요"
        >
          <Stack gap={6}>
            {requiredFails.map((c) => (
              <Text key={c.name} size="sm">
                <b>{c.name}</b>: {c.detail}
                {c.hint && (
                  <Text component="span" display="block" size="xs" c="dimmed">
                    → {c.hint}
                  </Text>
                )}
              </Text>
            ))}
            <Anchor component="button" size="xs" onClick={recheckHealth} data-testid="health-recheck">
              다시 점검
            </Anchor>
          </Stack>
        </Alert>
      )}
      {health && requiredFails.length === 0 && (
        <Group gap={8} mt="md">
          <Text data-testid="health-ok" size="xs" c="green">
            ✓ 환경 점검 통과 — Claude CLI · figma-edm 스킬 · Chrome · Python
          </Text>
          <Anchor component="button" size="xs" c="dimmed" onClick={recheckHealth} data-testid="health-recheck">
            다시 점검
          </Anchor>
        </Group>
      )}
      {optionalFails.length > 0 && (
        <Stack gap={2} mt={6} data-testid="health-optional">
          {optionalFails.map((c) => (
            <Text key={c.name} size="xs" c="dimmed">
              ○ {c.name}: {c.detail}
              {c.hint && ` — ${c.hint}`}
            </Text>
          ))}
        </Stack>
      )}

      <Paper withBorder p="lg" mt="xl" component="form" onSubmit={submit}>
        <TextInput
          data-testid="figma-url"
          label="Figma 디자인 URL"
          placeholder="https://www.figma.com/design/…?node-id=2343-115"
          required
          value={figmaUrl}
          onChange={(e) => setFigmaUrl(e.currentTarget.value)}
          error={
            parsed === null
              ? "Figma 디자인 URL 형식이 아닙니다 (figma.com/design/… 링크를 붙여넣으세요)"
              : undefined
          }
          styles={{ input: { fontFamily: "var(--font-geist-mono)", fontSize: 13 } }}
        />
        {parsed && (
          <Text data-testid="url-parsed" size="xs" c="green" mt={6}>
            ✓ {parsed.title || parsed.fileKey}
            {parsed.nodeId
              ? ` · 노드 ${parsed.nodeId.replace(/:/g, "-")}`
              : " · 노드 미지정 (URL에 node-id 권장)"}
          </Text>
        )}
        <Group mt="md" gap="sm">
          <Select
            data-testid="provider"
            value={provider}
            onChange={setProvider}
            data={providers.map((p) => ({ value: p.id, label: p.label }))}
            allowDeselect={false}
            w={280}
          />
          <Button
            data-testid="submit"
            type="submit"
            loading={submitting}
            disabled={parsed === null}
          >
            HTML 만들기
          </Button>
        </Group>
        {error && (
          <Text c="red" size="sm" mt="sm">
            {error}
          </Text>
        )}
      </Paper>

      <SettingsPanel onSaved={load} />

      <Group justify="space-between" align="baseline" mt={48} mb="sm">
        <Title order={2} size="h4">
          작업 히스토리
        </Title>
        <Group gap="sm">
          {jobs.length > 0 && (
            <Text size="xs" c="dimmed">
              {jobs.length}건
            </Text>
          )}
          {jobs.some((j) => j.status === "succeeded" || j.status === "failed") && (
            <Anchor
              component="button"
              size="xs"
              c="red"
              onClick={clearHistory}
              data-testid="clear-history"
            >
              {confirmClear ? "정말 모두 삭제?" : "완료된 작업 모두 삭제"}
            </Anchor>
          )}
        </Group>
      </Group>

      <Paper withBorder>
        {jobs.length === 0 && (
          <Group p="lg" gap="sm">
            <Text size="sm" c="dimmed">
              아직 작업이 없습니다.
            </Text>
            <Button
              data-testid="try-mock"
              variant="light"
              size="xs"
              loading={submitting}
              onClick={() =>
                createAndGo(
                  "https://www.figma.com/design/EXAMPLEfileKey12345678/?node-id=2343-115",
                  "mock",
                )
              }
            >
              샘플로 체험해보기 (토큰 소모 없음)
            </Button>
          </Group>
        )}
        {jobs.map((job, i) => {
          const badge = STATUS_BADGE[job.status] ?? { color: "gray", label: job.status };
          return (
            <div key={job.id}>
              {i > 0 && <Divider />}
              <Group px="lg" py="sm" gap="sm" wrap="nowrap">
                <Badge color={badge.color} variant="light" size="sm" miw={64}>
                  {badge.label}
                </Badge>
                <Anchor
                  href={`/jobs/${job.id}`}
                  underline="never"
                  c="inherit"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Text size="sm" fw={500} truncate>
                    {job.title || figmaLabel(job.figmaUrl)}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace" truncate>
                    {job.title ? `${figmaLabel(job.figmaUrl)} · ` : ""}
                    {job.provider}
                  </Text>
                </Anchor>
                <Tooltip label={new Date(job.createdAt).toLocaleString("ko-KR")}>
                  <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {relativeTime(job.createdAt)}
                  </Text>
                </Tooltip>
                {job.status === "succeeded" && (
                  <Anchor href={`/api/jobs/${job.id}/download`} size="xs" fw={500}>
                    zip
                  </Anchor>
                )}
                {job.status !== "running" && job.status !== "queued" && (
                  <Anchor component="button" size="xs" c="red" onClick={() => removeJob(job.id)}>
                    {confirmId === job.id ? "정말 삭제?" : "삭제"}
                  </Anchor>
                )}
              </Group>
            </div>
          );
        })}
      </Paper>
    </Container>
  );
}
