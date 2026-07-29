"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { figmaLabel, formatElapsed } from "../../lib/format";
import ArtifactList, { type Artifact } from "./ArtifactList";
import LogViewer, { type AgentEvent } from "./LogViewer";
import SendPrep from "./SendPrep";
import VerifyReport from "./VerifyReport";

interface Job {
  id: string;
  figmaUrl: string;
  title?: string;
  provider: string;
  status: string;
  createdAt: number;
  finishedAt?: number;
  summary?: string;
}

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  queued: { color: "gray", label: "대기" },
  running: { color: "blue", label: "실행 중" },
  succeeded: { color: "green", label: "완료" },
  failed: { color: "red", label: "실패" },
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [verifyFiles, setVerifyFiles] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notify, setNotify] = useState(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // localStorage는 SSR에 없어 마운트 후 1회 동기화가 불가피하다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotify(localStorage.getItem("mhm-notify") === "1" && Notification.permission === "granted");
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/jobs/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setJob(data.job);
    setArtifacts(data.artifacts);
    setVerifyFiles(data.verifyFiles ?? []);
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
    if (!terminal || !notify || Notification.permission !== "granted") return;
    // 페이지 진입 시점에 이미 끝나 있던 작업엔 알리지 않는다.
    if (job.finishedAt && Date.now() - job.finishedAt > 10_000) return;
    notifiedRef.current = true;
    new Notification(job.status === "succeeded" ? "eDM 변환 완료" : "eDM 변환 실패", {
      body: job.title || figmaLabel(job.figmaUrl),
    });
  }, [job, notify]);

  const running = !!job && (job.status === "queued" || job.status === "running");
  // 실행 중 헤더에 보여줄 현재 단계 = 마지막 status 이벤트.
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
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotify(true);
      localStorage.setItem("mhm-notify", "1");
    }
  }

  async function cancel() {
    const res = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
    if (!res.ok) {
      notifications.show({ message: (await res.json()).error ?? "취소 실패", color: "red" });
    }
  }

  async function rerun() {
    if (!job) return;
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ figmaUrl: job.figmaUrl, provider: job.provider }),
    });
    const data = await res.json();
    if (!res.ok) {
      notifications.show({ message: data.error ?? "재실행 실패", color: "red" });
      return;
    }
    router.push(`/jobs/${data.job.id}`);
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      notifications.show({ message: (await res.json()).error ?? "삭제 실패", color: "red" });
      setConfirmDelete(false);
      return;
    }
    router.push("/");
  }

  const badge = job ? (STATUS_BADGE[job.status] ?? { color: "gray", label: job.status }) : null;

  return (
    <Container size={680} py={56}>
      <Anchor href="/" size="sm">
        ← 홈으로
      </Anchor>

      <Group mt="md" gap="sm" wrap="nowrap" align="center">
        <Title order={1} size={22} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
          {job?.title || (job ? figmaLabel(job.figmaUrl) : `작업 ${id}`)}
        </Title>
        {badge && (
          <Badge data-testid="job-status" color={badge.color} variant="light" size="lg">
            {badge.label}
          </Badge>
        )}
      </Group>
      {job && (
        <Text size="xs" c="dimmed" ff="monospace" mt={4} truncate>
          {figmaLabel(job.figmaUrl)} · {job.provider} · 작업 {job.id}
        </Text>
      )}

      {job && (
        <Group mt="md" gap="xs">
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
              <Button variant="default" size="compact-sm" onClick={toggleNotify}>
                {notify ? "🔔 완료 시 알림 켜짐" : "🔕 완료 시 알림"}
              </Button>
              <Button
                data-testid="cancel"
                variant="outline"
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
              <Button data-testid="rerun" variant="default" size="compact-sm" onClick={rerun}>
                다시 실행
              </Button>
              <Button
                data-testid="delete"
                variant="outline"
                color="red"
                size="compact-sm"
                onClick={remove}
              >
                {confirmDelete ? "정말 삭제할까요?" : "삭제"}
              </Button>
            </>
          )}
        </Group>
      )}

      {running && currentStep && (
        <Alert data-testid="current-step" mt="md" color="blue" variant="light" p="sm">
          <Group gap="xs">
            <Loader size="xs" color="blue" />
            <Text size="sm">{currentStep}</Text>
          </Group>
        </Alert>
      )}

      <Text size="xs" fw={600} c="dimmed" mt={28}>
        진행 로그
      </Text>
      <LogViewer events={events} />

      {job?.summary && (
        <Alert
          mt="md"
          p="sm"
          variant="light"
          color={job.status === "failed" ? "red" : job.status === "succeeded" ? "green" : "gray"}
        >
          <Text size="sm">{job.summary}</Text>
        </Alert>
      )}

      {!running && <VerifyReport jobId={id} files={verifyFiles} />}

      {job?.status === "succeeded" && artifacts.some((a) => a.rel.endsWith(".html")) && (
        <SendPrep jobId={id} jobTitle={job?.title} onCreated={() => void refresh()} />
      )}

      <ArtifactList jobId={id} artifacts={artifacts} running={running} />
    </Container>
  );
}
