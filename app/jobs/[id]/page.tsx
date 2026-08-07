"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Anchor, Button, Container, Group, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Streamdown } from "streamdown";
import { figmaLabel, formatElapsed } from "../../lib/format";
import { PAGE_WIDTH, PROSE_WIDTH } from "../../lib/dimensions";
import { isActive } from "../../lib/status";
import { requestJson, sendJson } from "../../lib/request";
import AppHeader from "../../components/AppHeader";
import DiagnosticsLink from "../../components/DiagnosticsLink";
import Section from "../../components/Section";
import StatusDot from "../../components/StatusDot";
import { IconBell, IconBellOff, IconDownload } from "../../components/icons";
import ArtifactList, { type Artifact } from "./ArtifactList";
import FailureHelp from "./FailureHelp";
import LogViewer, { type AgentEvent } from "./LogViewer";
import SendPrep from "./SendPrep";
import VerifyReport, { type VerifySummary } from "./VerifyReport";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
  provider: string;
  status: string;
  createdAt: number;
  finishedAt?: number;
  summary?: string;
  verify?: VerifySummary;
  editOf?: string;
  instruction?: string;
  manualEdits?: Record<string, number>;
}

interface JobDetail {
  job: Job;
  artifacts: Artifact[];
  verifyFiles?: string[];
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [verifyFiles, setVerifyFiles] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editText, setEditText] = useState("");
  const [editing, setEditing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [notify, setNotify] = useState(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // localStorage는 SSR에 없어 마운트 후 1회 동기화가 불가피하다.
    // Notification 미지원 브라우저(iOS Safari 등)에서 ReferenceError 방지.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotify(
      "Notification" in window &&
        localStorage.getItem("mhm-notify") === "1" &&
        Notification.permission === "granted",
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    // SSE 오류 핸들러에서도 불린다 — 서버가 죽어 fetch가 거부되면 여기서
    // 던지는 대신 조용히 다음 시도를 기다린다.
    const r = await requestJson<JobDetail>(`/api/jobs/${id}`);
    if (!r.ok) return;
    setJob(r.data.job);
    setArtifacts(r.data.artifacts);
    setVerifyFiles(r.data.verifyFiles ?? []);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // refresh는 async — setState는 fetch 완료 후 콜백에서 일어난다 (lint false positive)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    const es = new EventSource(`/api/jobs/${id}/events`);
    // 재연결 시 서버가 히스토리를 다시 리플레이하므로 중복 방지를 위해 비운다.
    es.onopen = () => setEvents([]);
    es.addEventListener("agent", (e) => {
      setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });
    es.addEventListener("state", (e) => {
      const next = JSON.parse((e as MessageEvent).data) as Job | null;
      if (next) {
        setJob(next);
        if (next.status === "succeeded" || next.status === "failed") {
          void refresh();
          es.close();
        }
      }
    });
    es.onerror = () => {
      void refresh();
    };
    return () => es.close();
  }, [id, refresh]);

  // 완료/실패 시 브라우저 알림 (옵트인).
  useEffect(() => {
    if (!job || notifiedRef.current) return;
    const terminal = job.status === "succeeded" || job.status === "failed";
    if (!terminal || !notify) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    // 페이지 진입 시점에 이미 끝나 있던 작업엔 알리지 않는다.
    if (job.finishedAt && Date.now() - job.finishedAt > 10_000) return;
    notifiedRef.current = true;
    new Notification(job.status === "succeeded" ? "eDM 변환 완료" : "eDM 변환 실패", {
      body: job.title || figmaLabel(job.figmaUrl),
    });
  }, [job, notify]);

  const running = isActive(job?.status);
  // 실행 중 로그 헤더에 보여줄 현재 단계 = 마지막 status 이벤트.
  const currentStep = running
    ? events.filter((e) => e.type === "status").at(-1)?.text
    : undefined;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function toggleNotify() {
    if (notify) {
      setNotify(false);
      localStorage.setItem("mhm-notify", "0");
      return;
    }
    if (!("Notification" in window)) {
      notifications.show({ message: "이 브라우저는 알림을 지원하지 않습니다.", color: "yellow" });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotify(true);
      localStorage.setItem("mhm-notify", "1");
    }
  }

  async function cancel() {
    const r = await sendJson(`/api/jobs/${id}/cancel`, "POST");
    if (!r.ok) notifications.show({ message: r.error, color: "red" });
  }

  async function rerun() {
    if (!job) return;
    const r = await sendJson<{ job: { id: string } }>("/api/jobs", "POST", {
      figmaUrl: job.figmaUrl,
      provider: job.provider,
    });
    if (!r.ok) {
      notifications.show({ message: r.error, color: "red" });
      return;
    }
    router.push(`/jobs/${r.data.job.id}`);
  }

  async function resume() {
    // 더블클릭이 같은 workDir에서 CLI를 두 개 띄우는 것을 서버 가드에 앞서 차단.
    if (resuming) return;
    setResuming(true);
    const r = await sendJson(`/api/jobs/${id}/resume`, "POST");
    if (!r.ok) {
      setResuming(false);
      notifications.show({ message: r.error, color: "red" });
      return;
    }
    // 종료 시 닫힌 SSE를 되살리는 가장 단순한 방법 — 새로고침으로 재구독.
    window.location.reload();
  }

  async function requestEdit() {
    const instruction = editText.trim();
    if (!instruction) return;
    if (editing) return;
    setEditing(true);
    try {
      const r = await sendJson<{ job: { id: string } }>(`/api/jobs/${id}/edit`, "POST", {
        instruction,
      });
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      router.push(`/jobs/${r.data.job.id}`);
    } finally {
      setEditing(false);
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const r = await sendJson(`/api/jobs/${id}`, "DELETE");
    if (!r.ok) {
      notifications.show({ message: r.error, color: "red" });
      setConfirmDelete(false);
      return;
    }
    router.push("/");
  }

  return (
    <>
      <AppHeader
        breadcrumb={
          <Text size="sm" c="dimmed" ff="monospace" truncate>
            {id}
          </Text>
        }
        right={job ? <StatusDot status={job.status} size="lg" testId="job-status" /> : undefined}
      />

      <Container size={PAGE_WIDTH} pt={32} pb={72}>
        <Anchor href="/" size="xs" c="dimmed">
          ← 홈으로
        </Anchor>

        <Title order={1} mt={10} style={{ letterSpacing: "-0.015em" }} lineClamp={2}>
          {job?.title || (job ? figmaLabel(job.figmaUrl) : `작업 ${id}`)}
        </Title>

        {job && (
          <Text size="xs" c="dimmed" ff="monospace" mt={6} truncate>
            {figmaLabel(job.figmaUrl)} · {job.provider} · {job.id}
            {job.editOf && (
              <>
                {" · 원본 "}
                <Anchor href={`/jobs/${job.editOf}`} size="xs" ff="monospace">
                  {job.editOf}
                </Anchor>
              </>
            )}
          </Text>
        )}
        {job?.instruction && (
          <Text size="xs" c="dimmed" mt={4} maw={PROSE_WIDTH} lineClamp={2}>
            수정 지시: {job.instruction}
          </Text>
        )}

        {job && (
          <Group mt="lg" gap="sm" wrap="wrap">
            <Text
              data-testid="elapsed"
              size="sm"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              소요 시간 {formatElapsed((job.finishedAt ?? now) - job.createdAt)}
            </Text>
            <div style={{ flex: 1 }} />
            {running && (
              <>
                <Button
                  variant="default"
                  size="compact-sm"
                  onClick={toggleNotify}
                  leftSection={notify ? <IconBell size={14} /> : <IconBellOff size={14} />}
                >
                  {notify ? "완료 시 알림 켜짐" : "완료 시 알림"}
                </Button>
                {/* variant="default"는 color를 무시한다 — 파괴적 동작이 무해한
                    버튼과 똑같이 보이면 안 되므로 light로 톤만 실어 준다. */}
                <Button
                  data-testid="cancel"
                  variant="light"
                  color="red"
                  size="compact-sm"
                  onClick={cancel}
                >
                  취소
                </Button>
              </>
            )}
            {!running && (
              <>
                {job.status === "failed" && (
                  <Button
                    data-testid="resume"
                    size="compact-sm"
                    onClick={resume}
                    loading={resuming}
                    title="중간 산출물을 재사용해 미완료 항목만 이어서 진행합니다"
                  >
                    이어서 실행
                  </Button>
                )}
                <Button data-testid="rerun" variant="default" size="compact-sm" onClick={rerun}>
                  다시 실행
                </Button>
                <Button
                  data-testid="delete"
                  variant="light"
                  color="red"
                  size="compact-sm"
                  onClick={remove}
                >
                  {confirmDelete ? "정말 삭제할까요?" : "삭제"}
                </Button>
              </>
            )}
            <DiagnosticsLink jobId={job.id} />
          </Group>
        )}

        {/* 실패한 잡의 첫 질문은 "왜"다 — 로그보다 위에 둔다. */}
        {job?.status === "failed" && <FailureHelp job={job} />}

        <Section
          title="진행 로그"
          mt="xl"
          flush
          right={
            currentStep ? (
              <Text data-testid="current-step" size="xs" c="dimmed" truncate maw={340}>
                {currentStep}
              </Text>
            ) : undefined
          }
        >
          <LogViewer events={events} />
        </Section>

        {job?.summary && (
          <Section title="결과 요약">
            {/* 에이전트 요약은 마크다운(표·볼드 포함) — Streamdown으로 렌더 */}
            <div style={{ fontSize: 13, lineHeight: 1.7, overflowX: "auto" }}>
              <Streamdown>{job.summary}</Streamdown>
            </div>
          </Section>
        )}

        {job?.manualEdits && Object.keys(job.manualEdits).length > 0 && (
          <Text size="xs" c="yellow" mt="md" data-testid="manual-edit-note">
            수동 수정됨: {Object.keys(job.manualEdits).join(", ")} — 아래 픽셀 검증 결과는 수정 전
            기준이며, 다른 산출물 파일과 어긋날 수 있습니다.
          </Text>
        )}

        {!running && <VerifyReport jobId={id} files={verifyFiles} verify={job?.verify} />}

        {job?.status === "succeeded" && artifacts.some((a) => a.rel.endsWith(".html")) && (
          <>
            <Section
              title="부분 수정"
              subtitle="기존 빌드를 복사한 새 작업에서 지시한 변경만 적용하고 재검증합니다. 원본 작업은 그대로 남습니다."
            >
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <TextInput
                  data-testid="edit-instruction"
                  value={editText}
                  onChange={(e) => setEditText(e.currentTarget.value)}
                  placeholder='예: 헤드라인 "지금 시작하세요"를 "오늘 시작하세요"로 변경'
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void requestEdit();
                  }}
                />
                <Button
                  data-testid="edit-run"
                  onClick={requestEdit}
                  loading={editing}
                  disabled={editText.trim().length < 4}
                >
                  수정 실행
                </Button>
              </Group>
            </Section>

            <SendPrep jobId={id} jobTitle={job?.title} onCreated={() => void refresh()} />
          </>
        )}

        <Section
          title={`산출물 (${artifacts.length})`}
          flush
          right={
            artifacts.length > 0 ? (
              <Button
                data-testid="download-zip"
                component="a"
                href={`/api/jobs/${id}/download`}
                size="compact-sm"
                leftSection={<IconDownload size={14} />}
              >
                전체 zip
              </Button>
            ) : undefined
          }
        >
          <ArtifactList jobId={id} artifacts={artifacts} running={running} />
        </Section>
      </Container>
    </>
  );
}
