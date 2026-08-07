"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../../lib/request";
import type { AgentEvent } from "@/lib/providers/types";
import type { Artifact, Job } from "@/lib/jobs/store";

interface JobDetail {
  job: Job;
  artifacts: Artifact[];
  verifyFiles?: string[];
}

/**
 * 잡 상세 + SSE 라이브 스트림 구독 — 페이지에서 가장 미묘한 배선을 한곳에 모은다.
 *
 * 지키는 것들 (각각 깨질 때의 증상이 커서 페이지 렌더링과 분리해 둔다):
 * - 재연결 시 서버가 히스토리를 다시 리플레이하므로 onopen에서 events를 비운다
 *   — 안 비우면 같은 로그가 두 벌씩 쌓인다.
 * - "state" 이벤트로 터미널 상태가 오면 refresh(산출물·검증 파일 갱신) 후
 *   스트림을 닫는다 — 열어 두면 EventSource가 영원히 재연결을 반복한다.
 * - onerror에서도 refresh만 한다 — 서버가 죽어 fetch가 거부되면 requestJson이
 *   조용히 실패하고 다음 재연결을 기다린다 (여기서 던지면 화면이 죽는다).
 */
export function useJobStream(id: string | undefined) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [verifyFiles, setVerifyFiles] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!id) return;
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

  return { job, events, artifacts, verifyFiles, refresh };
}
