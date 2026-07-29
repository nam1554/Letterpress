"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import SettingsPanel from "./components/SettingsPanel";
import BackendSetup, { type BackendInfo } from "./components/BackendSetup";
import { parseFigmaUrl } from "@/lib/figma";
import { fetcher } from "./lib/fetcher";
import { figmaLabel, formatBytes, relativeTime } from "./lib/format";
import { sendJson } from "./lib/request";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
  provider: string;
  status: string;
  createdAt: number;
  summary?: string;
  diskBytes?: number;
}

type StatusFilter = "all" | "running" | "succeeded" | "failed";
interface ProviderInfo {
  id: string;
  label: string;
}
interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}
interface JobsResponse {
  jobs: Job[];
  providers: ProviderInfo[];
  defaultProvider: string;
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
  // null = 사용자가 아직 선택 안 함 → 서버의 기본 백엔드를 따른다.
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  // 잡 목록은 5초 폴링 — 실행 중 잡의 상태 변화를 홈에서도 따라간다.
  const { data: jobsData } = useSWR<JobsResponse>("/api/jobs", fetcher, {
    refreshInterval: 5000,
  });
  const jobs = jobsData?.jobs ?? [];
  const providers = jobsData?.providers ?? [];
  const provider = providerChoice ?? jobsData?.defaultProvider ?? null;

  const { data: healthData } = useSWR<{ checks: HealthCheck[] }>("/api/health", fetcher, {
    revalidateOnFocus: false,
  });
  const health = healthData?.checks ?? null;
  const [recheckingHealth, setRecheckingHealth] = useState(false);

  // 백엔드 연동 진단은 비싸다(mcp list 헬스체크) — 포커스 재검증 없이 명시적으로만.
  const { data: setupData, error: setupError } = useSWR<{ backends: BackendInfo[] }>(
    "/api/setup",
    fetcher,
    { revalidateOnFocus: false },
  );
  const [recheckingSetup, setRecheckingSetup] = useState(false);
  const backends: BackendInfo[] | null = recheckingSetup
    ? null
    : (setupData?.backends ?? (setupError ? [] : null));

  const parsed = useMemo(
    () => (figmaUrl.trim() ? parseFigmaUrl(figmaUrl) : undefined),
    [figmaUrl],
  );

  async function recheckHealth() {
    setRecheckingHealth(true);
    try {
      const fresh = await fetcher("/api/health?force=1");
      await mutate("/api/health", fresh, { revalidate: false });
    } catch {
      /* 기존 표시 유지 */
    } finally {
      setRecheckingHealth(false);
    }
  }

  const refreshSetup = useCallback(async (force = false) => {
    if (!force) {
      await mutate("/api/setup");
      return;
    }
    setRecheckingSetup(true);
    try {
      const fresh = await fetcher("/api/setup?force=1");
      await mutate("/api/setup", fresh, { revalidate: false });
    } catch {
      /* 기존 캐시 유지 — 빈 화면 대신 이전 상태를 보여준다 */
    } finally {
      setRecheckingSetup(false);
    }
  }, []);

  async function createAndGo(url: string, providerId: string) {
    if (submitting) return; // 더블클릭 한 번이 에이전트 실행 하나를 더 만든다.
    setError("");
    setSubmitting(true);
    try {
      const r = await sendJson<{ job: { id: string } }>("/api/jobs", "POST", {
        figmaUrl: url,
        provider: providerId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/jobs/${r.data.job.id}`);
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
    const r = await sendJson(`/api/jobs/${id}`, "DELETE");
    if (r.ok) {
      notifications.show({ message: "작업을 삭제했습니다.", color: "gray" });
      void mutate("/api/jobs");
    } else setError(r.error);
  }

  async function clearHistory() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const r = await sendJson<{ deleted: number }>("/api/jobs", "DELETE");
    if (r.ok) {
      notifications.show({
        message: `완료된 작업 ${r.data.deleted}건을 삭제했습니다.`,
        color: "gray",
      });
      void mutate("/api/jobs");
    } else setError(r.error);
  }

  const requiredFails = health?.filter((c) => !c.ok) ?? [];
  const selectedBackend = backends?.find((b) => b.id === provider);

  const totalBytes = jobs.reduce((sum, j) => sum + (j.diskBytes ?? 0), 0);
  const visibleJobs = jobs.filter((j) => {
    if (statusFilter === "running" && j.status !== "running" && j.status !== "queued") return false;
    if (statusFilter === "succeeded" && j.status !== "succeeded") return false;
    if (statusFilter === "failed" && j.status !== "failed") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [j.id, j.figmaUrl, j.provider, j.title ?? "", j.summary ?? ""].some((s) =>
      s.toLowerCase().includes(q),
    );
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFailed() {
    setSelected(new Set(jobs.filter((j) => j.status === "failed").map((j) => j.id)));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const r = await sendJson<{ results: Array<{ id: string; ok: boolean }> }>(
      "/api/jobs/bulk-delete",
      "POST",
      { ids: [...selected] },
    );
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSelected(new Set());
    void mutate("/api/jobs");
    const failed = r.data.results.filter((x) => !x.ok).length;
    const deleted = r.data.results.length - failed;
    notifications.show({
      message:
        failed > 0
          ? `${deleted}건 삭제, ${failed}건은 삭제하지 못했습니다 (실행 중이거나 없음).`
          : `작업 ${deleted}건을 삭제했습니다.`,
      color: failed > 0 ? "yellow" : "gray",
    });
  }

  return (
    <Container size={680} py={56}>
      <Group align="baseline" gap="sm">
        <Title order={1} size={28}>
          Letterpress
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
              {recheckingHealth ? "점검 중…" : "다시 점검"}
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
            {recheckingHealth ? "점검 중…" : "다시 점검"}
          </Anchor>
        </Group>
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
            onChange={setProviderChoice}
            data={providers.map((p) => {
              const b = backends?.find((x) => x.id === p.id);
              return {
                value: p.id,
                label: b && !b.ready ? `${p.label} · 설정 필요` : p.label,
              };
            })}
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
        {selectedBackend && !selectedBackend.ready && (
          <Alert color="yellow" variant="light" mt="sm" p="xs" data-testid="provider-warning">
            <Text size="xs">
              선택한 백엔드가 아직 준비되지 않았습니다 — 아래 <b>🔌 백엔드 연동</b>에서 남은
              단계를 확인하세요. 그대로 실행하면 실패할 수 있습니다.
            </Text>
          </Alert>
        )}
        {error && (
          <Text c="red" size="sm" mt="sm">
            {error}
          </Text>
        )}
      </Paper>

      <BackendSetup backends={backends} onRefresh={(force) => void refreshSetup(force)} />

      <SettingsPanel
        onSaved={() => {
          void mutate("/api/jobs");
          void refreshSetup(true);
        }}
      />

      <Group justify="space-between" align="baseline" mt={48} mb="sm">
        <Title order={2} size="h4">
          작업 히스토리
        </Title>
        <Group gap="sm">
          {jobs.length > 0 && (
            <Text size="xs" c="dimmed" data-testid="disk-total">
              {jobs.length}건 · 총 {formatBytes(totalBytes)}
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

      {jobs.length > 0 && (
        <Group gap="sm" mb="sm" wrap="wrap">
          <SegmentedControl
            data-testid="status-filter"
            size="xs"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            data={[
              { value: "all", label: "전체" },
              { value: "running", label: "실행 중" },
              { value: "succeeded", label: "완료" },
              { value: "failed", label: "실패" },
            ]}
          />
          <TextInput
            data-testid="job-search"
            size="xs"
            w={200}
            placeholder="id · URL · 백엔드 · 요약 검색"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {jobs.some((j) => j.status === "failed") && (
            <Anchor component="button" size="xs" onClick={selectFailed} data-testid="select-failed">
              실패한 잡 선택
            </Anchor>
          )}
          {selected.size > 0 && (
            <Button
              data-testid="delete-selected"
              color="red"
              variant="light"
              size="compact-xs"
              onClick={deleteSelected}
            >
              선택 삭제 ({selected.size})
            </Button>
          )}
        </Group>
      )}

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
        {jobs.length > 0 && visibleJobs.length === 0 && (
          <Text p="lg" size="sm" c="dimmed">
            조건에 맞는 작업이 없습니다.
          </Text>
        )}
        {visibleJobs.map((job, i) => {
          const badge = STATUS_BADGE[job.status] ?? { color: "gray", label: job.status };
          const deletable = job.status !== "running" && job.status !== "queued";
          return (
            <div key={job.id}>
              {i > 0 && <Divider />}
              <Group px="lg" py="sm" gap="sm" wrap="nowrap">
                <Checkbox
                  size="xs"
                  aria-label="선택"
                  disabled={!deletable}
                  checked={selected.has(job.id)}
                  onChange={() => toggleSelected(job.id)}
                />
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
                {job.diskBytes !== undefined && (
                  <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatBytes(job.diskBytes)}
                  </Text>
                )}
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
