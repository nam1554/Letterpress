"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Container,
  Group,
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
import DiagnosticsLink from "./components/DiagnosticsLink";
import AppHeader from "./components/AppHeader";
import Section from "./components/Section";
import StatusDot from "./components/StatusDot";
import { IconAlert, IconCheck } from "./components/icons";
import { parseFigmaUrl } from "@/lib/figma";
import { fetcher } from "./lib/fetcher";
import { figmaLabel, formatBytes, relativeTime } from "./lib/format";
import { PAGE_WIDTH, PROSE_WIDTH } from "./lib/dimensions";
import { providerOptionLabel } from "./lib/provider-select";
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
  verification: "verified" | "unverified" | "sample";
  verificationNote: string;
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

/**
 * 히스토리 행 그리드. 이전엔 Group + flex라서 크기·시간 열이 줄마다 다른
 * 위치에 놓여 눈에 거슬렸다 — 열 폭을 고정해 세로로 정렬한다.
 * (선택 · 상태 · 제목 · 용량 · 시간 · 액션)
 */
const ROW_GRID = "20px 76px minmax(0,1fr) 68px 72px 96px";

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
  // 삭제 확인이 걸린 대상 목록(id 조인) — null이면 확인 전.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // 준비 안 된 백엔드로 실행하기 전 한 번 더 확인.
  const [confirmUnready, setConfirmUnready] = useState(false);
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
    if (!provider) return;
    // 준비 안 된 백엔드로 실행하면 10~20분을 기다린 끝에 실패한다 — 한 번 더 묻는다.
    if (notReady && !confirmUnready) {
      setConfirmUnready(true);
      return;
    }
    setConfirmUnready(false);
    await createAndGo(figmaUrl, provider);
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
  const notReady = Boolean(selectedBackend && !selectedBackend.ready);
  const selectedProvider = providers.find((p) => p.id === provider);
  const unverified = selectedProvider?.verification === "unverified";

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

  // 실제로 지울 대상은 "화면에 보이는 선택"뿐이다 — 필터·검색으로 감춰진 잡이나
  // 이미 사라진 잡까지 지우면 사용자가 못 본 결과물이 복구 불가능하게 날아간다.
  const selectedIds = visibleJobs.filter((j) => selected.has(j.id)).map((j) => j.id);
  // 확인은 "지금 화면의 그 목록"에만 유효하다 — 확인 후 필터를 바꾸면 다시 묻는다.
  const deleteArmed = confirmDelete !== null && confirmDelete === selectedIds.join(",");

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFailed() {
    setSelected(new Set(visibleJobs.filter((j) => j.status === "failed").map((j) => j.id)));
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    if (!deleteArmed) {
      setConfirmDelete(selectedIds.join(","));
      return;
    }
    setConfirmDelete(null);
    const r = await sendJson<{ results: Array<{ id: string; ok: boolean }> }>(
      "/api/jobs/bulk-delete",
      "POST",
      { ids: selectedIds },
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
    <>
      <AppHeader
        right={
          <>
            {health && (
              <Text
                data-testid={requiredFails.length === 0 ? "health-ok" : undefined}
                size="xs"
                fw={500}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color:
                    requiredFails.length === 0
                      ? "var(--mantine-color-green-light-color)"
                      : "var(--mantine-color-yellow-light-color)",
                }}
              >
                {requiredFails.length === 0 ? <IconCheck size={13} /> : <IconAlert size={13} />}
                {requiredFails.length === 0 ? "환경 정상" : `환경 점검 ${requiredFails.length}건`}
              </Text>
            )}
            <Anchor
              component="button"
              type="button"
              size="xs"
              c="dimmed"
              onClick={recheckHealth}
              data-testid="health-recheck"
            >
              {recheckingHealth ? "점검 중…" : "다시 점검"}
            </Anchor>
          </>
        }
      />

      <Container size={PAGE_WIDTH} pt={40} pb={72}>
        <Title order={1} style={{ letterSpacing: "-0.015em" }}>
          Figma 디자인을 이메일 HTML로
        </Title>
        <Text c="dimmed" size="sm" mt={8} maw={PROSE_WIDTH}>
          링크를 붙여넣으면 에이전트가 픽셀 검증까지 마친 이메일 HTML을 만들어
          드립니다. 완료 후 HTML + 이미지 폴더를 zip으로 받으세요.
        </Text>

        {requiredFails.length > 0 && (
          <Alert
            data-testid="health-banner"
            color="yellow"
            variant="light"
            mt="lg"
            icon={<IconAlert size={18} />}
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
            </Stack>
          </Alert>
        )}

        {/* 처음 받은 사람이 "이걸 어떻게 하라는거야"가 되지 않도록 —
            아직 작업이 없고 환경도 안 갖춰졌을 때만 보인다. */}
        {jobs.length === 0 && (requiredFails.length > 0 || notReady) && (
          <Section title="처음이신가요? 순서는 이렇습니다" testId="first-run">
            <Stack gap={10} maw={PROSE_WIDTH}>
              <Text size="sm">
                <b>1.</b> 터미널에서 Claude Code CLI를 설치하고 <code>claude</code>를 한 번
                실행해 로그인합니다 — 명령은 아래 <b>백엔드 연동</b>에서 복사할 수 있어요.
              </Text>
              <Text size="sm">
                <b>2.</b> <code>claude</code> 대화에서 Figma 링크가 읽히는지 확인합니다
                (claude.ai Figma 커넥터 연결). 무료 Figma 시트라면 <b>설정</b>에 Figma 토큰을
                넣어도 됩니다.
              </Text>
              <Text size="sm">
                <b>3.</b> 위 두 가지가 초록불이 되면 Figma 디자인 링크를 붙여넣고 실행하세요.
                변환은 10~20분 걸립니다.
              </Text>
              <Text size="xs" c="dimmed">
                지금 당장 흐름만 보고 싶다면 아래 <b>샘플로 체험해보기</b>를 누르세요 — 환경
                없이도 결과물 다운로드까지 그대로 볼 수 있습니다. 어디서 막히든,{" "}
                <b>문제 신고용 파일 내려받기</b>를 눌러 받은 파일을 담당자에게 보내주시면
                됩니다 — 무엇이 문제인지 직접 알아낼 필요 없습니다.
              </Text>
            </Stack>
          </Section>
        )}

        <Section title="새 변환" mt="xl">
          <form onSubmit={submit}>
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
              <Text
                data-testid="url-parsed"
                size="xs"
                mt={6}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--mantine-color-green-light-color)",
                }}
              >
                <IconCheck size={13} />
                {parsed.title || parsed.fileKey}
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
                data={providers.map((p) => ({
                  value: p.id,
                  label: providerOptionLabel(
                    p,
                    backends?.find((x) => x.id === p.id),
                  ),
                }))}
                allowDeselect={false}
                w={280}
              />
              <Button
                data-testid="submit"
                type="submit"
                loading={submitting}
                disabled={parsed === null}
                color={notReady ? "yellow" : undefined}
              >
                {notReady
                  ? confirmUnready
                    ? "실패해도 실행"
                    : "준비 안 됨 — 그래도 실행?"
                  : "HTML 만들기"}
              </Button>
            </Group>
            {notReady && (
              <Alert
                color="yellow"
                variant="light"
                mt="md"
                p="sm"
                data-testid="provider-warning"
                icon={<IconAlert size={16} />}
              >
                <Text size="xs">
                  선택한 백엔드가 아직 준비되지 않았습니다 — 아래 <b>백엔드 연동</b>에서 남은
                  단계를 확인하세요. 지금 실행하면 대부분 실패합니다. 환경 없이 흐름만 보고
                  싶다면 아래 <b>샘플로 체험해보기</b>를 쓰세요.
                </Text>
              </Alert>
            )}
            {unverified && (
              <Alert
                color="yellow"
                variant="light"
                mt="md"
                p="sm"
                data-testid="provider-unverified"
                icon={<IconAlert size={16} />}
              >
                <Text size="xs">
                  이 백엔드는 <b>실제 변환을 끝까지 완주한 기록이 없습니다</b> — 설정이
                  끝나 있어도 중간에 실패할 수 있습니다. 확실한 결과가 필요하면 검증된
                  백엔드를 쓰세요. {selectedProvider?.verificationNote}
                </Text>
              </Alert>
            )}
            {error && (
              <Text c="red" size="sm" mt="sm">
                {error}
              </Text>
            )}
          </form>
        </Section>

        <BackendSetup backends={backends} onRefresh={(force) => void refreshSetup(force)} />

        <SettingsPanel
          onSaved={() => {
            void mutate("/api/jobs");
            void refreshSetup(true);
          }}
        />

        <Section
          title="작업 히스토리"
          mt="xl"
          flush
          right={
            <>
              {jobs.length > 0 && (
                <Text
                  size="xs"
                  c="dimmed"
                  data-testid="disk-total"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {jobs.length}건 · {formatBytes(totalBytes)}
                </Text>
              )}
              {jobs.some((j) => j.status === "succeeded" || j.status === "failed") && (
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="dimmed"
                  onClick={clearHistory}
                  data-testid="clear-history"
                >
                  {confirmClear ? "정말 모두 삭제?" : "완료된 작업 삭제"}
                </Anchor>
              )}
              <DiagnosticsLink />
            </>
          }
        >
          {jobs.length > 0 && (
            <Group
              gap="sm"
              wrap="wrap"
              px="lg"
              py="sm"
              style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
            >
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
                w={220}
                placeholder="id · URL · 백엔드 · 요약 검색"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              <div style={{ flex: 1 }} />
              {jobs.some((j) => j.status === "failed") && (
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  onClick={selectFailed}
                  data-testid="select-failed"
                >
                  실패한 잡 선택
                </Anchor>
              )}
              {selectedIds.length > 0 && (
                <Button
                  data-testid="delete-selected"
                  color="red"
                  variant="light"
                  size="compact-xs"
                  onClick={deleteSelected}
                >
                  {deleteArmed
                    ? `정말 ${selectedIds.length}건 삭제?`
                    : `선택 삭제 (${selectedIds.length})`}
                </Button>
              )}
            </Group>
          )}

          {jobs.length === 0 && (
            <Group p="lg" gap="md">
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
            const deletable = job.status !== "running" && job.status !== "queued";
            return (
              <div
                key={job.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: ROW_GRID,
                  alignItems: "center",
                  gap: "var(--mantine-spacing-sm)",
                  padding: "10px var(--mantine-spacing-lg)",
                  borderTop:
                    i > 0 ? "1px solid var(--mantine-color-default-border)" : undefined,
                }}
              >
                <Checkbox
                  size="xs"
                  aria-label="선택"
                  disabled={!deletable}
                  checked={selected.has(job.id)}
                  onChange={() => toggleSelected(job.id)}
                />
                <StatusDot status={job.status} />
                <Anchor
                  href={`/jobs/${job.id}`}
                  underline="never"
                  c="inherit"
                  style={{ minWidth: 0 }}
                >
                  <Text size="sm" fw={500} truncate>
                    {job.title || figmaLabel(job.figmaUrl)}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace" truncate>
                    {job.title ? `${figmaLabel(job.figmaUrl)} · ` : ""}
                    {job.provider}
                  </Text>
                </Anchor>
                <Text
                  size="xs"
                  c="dimmed"
                  ta="right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {job.diskBytes !== undefined ? formatBytes(job.diskBytes) : ""}
                </Text>
                <Tooltip label={new Date(job.createdAt).toLocaleString("ko-KR")}>
                  <Text
                    size="xs"
                    c="dimmed"
                    ta="right"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {relativeTime(job.createdAt)}
                  </Text>
                </Tooltip>
                <Group gap="md" justify="flex-end" wrap="nowrap">
                  {job.status === "succeeded" && (
                    <Anchor href={`/api/jobs/${job.id}/download`} size="xs" fw={500}>
                      zip
                    </Anchor>
                  )}
                  {deletable && (
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      c="dimmed"
                      onClick={() => removeJob(job.id)}
                    >
                      {confirmId === job.id ? "정말?" : "삭제"}
                    </Anchor>
                  )}
                </Group>
              </div>
            );
          })}
        </Section>
      </Container>
    </>
  );
}
