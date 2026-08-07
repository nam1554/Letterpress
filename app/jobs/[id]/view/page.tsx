"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isActive } from "../../../lib/status";
import { requestJson, sendJson } from "../../../lib/request";
import EditPanel, { type PanelTarget } from "./EditPanel";
import { EDIT_STYLE_ID, SELECTED_ATTR, serializeEditedDocument } from "./serialize";

const WIDTHS = [
  { label: "데스크톱 700", value: "700" },
  { label: "태블릿 600", value: "600" },
  { label: "모바일 375", value: "375" },
];

function CopyHtmlButton({ src }: { src: string }) {
  const [label, setLabel] = useState("HTML 복사");
  async function copy() {
    try {
      const html = await (await fetch(src)).text();
      await navigator.clipboard.writeText(html);
      setLabel("복사됨 ✓");
    } catch {
      setLabel("복사 실패");
    }
    setTimeout(() => setLabel("HTML 복사"), 2000);
  }
  return (
    <Button data-testid="copy-html" variant="default" size="compact-sm" onClick={copy}>
      {label}
    </Button>
  );
}

interface JobInfo {
  status: string;
  manualEdits?: Record<string, number>;
}

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const file = useSearchParams().get("file") ?? "";
  const [width, setWidth] = useState("700");
  const [job, setJob] = useState<JobInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [target, setTarget] = useState<PanelTarget | null>(null);
  // 선택된 요소가 바뀔 때마다 증가 — EditPanel의 key로 써서 강제 리마운트한다
  // (uncontrolled <input type="color" defaultValue>는 마운트 시에만 값을 반영하므로,
  // 리마운트 없이는 이전에 선택했던 요소의 색이 새 선택에도 계속 보인다).
  const [selVersion, setSelVersion] = useState(0);
  const lastSelectedElRef = useRef<HTMLElement | null>(null);
  // restore/편집 취소 후 서버의 현재 파일로 강제 리로드하기 위한 키.
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshJob = useCallback(async () => {
    if (!id) return;
    const r = await requestJson<{ job: JobInfo }>(`/api/jobs/${id}`);
    if (r.ok) setJob(r.data.job);
  }, [id]);

  useEffect(() => {
    // refreshJob은 async — setState는 fetch 완료 후 콜백에서 일어난다 (lint false positive)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshJob();
  }, [refreshJob]);

  // 저장하지 않은 변경이 있으면 탭 닫기/새로고침 전에 경고.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // "정말 되돌릴까요?" 무장 상태는 유예 시간(4s) 안에 두 번째 클릭이 없으면 풀린다 —
  // 한참 뒤의 클릭이 확인 없이 바로 실행되는 것을 막는다.
  useEffect(() => {
    if (!confirmRestore) return;
    const t = setTimeout(() => setConfirmRestore(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRestore]);

  // 파일이 바뀌거나 편집 모드가 전환되면 이전 되돌리기 확인 상태는 무효 — 그대로 두면
  // 다른 파일/모드로 넘어간 뒤의 클릭이 예상 못한 즉시 실행으로 이어질 수 있다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmRestore(false);
  }, [file, editing]);

  const onInput = useCallback(() => setDirty(true), [setDirty]);

  const onSelectionChange = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    if (!doc || !frame || !scroller) return;
    const node = doc.getSelection()?.anchorNode;
    const el =
      node == null
        ? null
        : node.nodeType === Node.TEXT_NODE
          ? node.parentElement
          : (node as HTMLElement);
    for (const prev of doc.querySelectorAll(`[${SELECTED_ATTR}]`)) {
      if (prev !== el) prev.removeAttribute(SELECTED_ATTR);
    }
    if (!el || el === doc.body || el.nodeType !== Node.ELEMENT_NODE) {
      setTarget(null);
      lastSelectedElRef.current = null;
      return;
    }
    el.setAttribute(SELECTED_ATTR, "");
    if (lastSelectedElRef.current !== el) {
      lastSelectedElRef.current = el;
      setSelVersion((v) => v + 1);
    }
    const rect = el.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    setTarget({
      el,
      left: frameRect.left - scrollRect.left + scroller.scrollLeft + rect.left,
      top: frameRect.top - scrollRect.top + scroller.scrollTop + rect.top,
    });
  }, [setTarget, setSelVersion]);

  const enableEditing = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.setAttribute("contenteditable", "true");
    if (!doc.getElementById(EDIT_STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = EDIT_STYLE_ID;
      style.textContent = `[${SELECTED_ATTR}] { outline: 2px solid #C4643B; outline-offset: 2px; }`;
      doc.head.appendChild(style);
    }
    doc.addEventListener("input", onInput);
    doc.addEventListener("selectionchange", onSelectionChange);
  }, [onInput, onSelectionChange]);

  if (!file) {
    return (
      <Container size={680} py={56}>
        <Text size="sm" c="dimmed">
          미리볼 파일이 지정되지 않았습니다.{" "}
          <Anchor href={`/jobs/${id}`}>작업 페이지로 돌아가기</Anchor>
        </Text>
      </Container>
    );
  }

  const src = `/api/jobs/${id}/preview/${file}${frameNonce ? `?v=${frameNonce}` : ""}`;
  // 편집 가능 = output 최상위 .html + 잡이 실행 중이 아님 (저장 API 허용 규칙과
  // 동일 — Windows의 listArtifacts는 하위 경로를 \ 로 잇는다, 저쪽만 검사하면
  // 서버가 400으로 거부할 파일에 편집 UI가 뜬다).
  const editable =
    file.endsWith(".html") &&
    !file.includes("/") &&
    !file.includes("\\") &&
    job !== null &&
    !isActive(job.status);
  const hasBackup = Boolean(job?.manualEdits?.[file]);

  function reloadFrame() {
    setDirty(false);
    setTarget(null);
    lastSelectedElRef.current = null;
    setFrameNonce((n) => n + 1);
  }

  function toggleEdit() {
    if (!editing) {
      setEditing(true);
      enableEditing();
      return;
    }
    if (dirty && !window.confirm("저장하지 않은 변경이 사라집니다. 편집을 끝낼까요?")) return;
    setEditing(false);
    reloadFrame();
  }

  async function save() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    setSaving(true);
    try {
      const html = serializeEditedDocument(doc);
      const r = await sendJson(`/api/jobs/${id}/artifact`, "PUT", { file, html });
      if (!r.ok) {
        // 실패해도 편집 내용은 iframe에 그대로 남는다 — 재시도 가능.
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      setDirty(false);
      notifications.show({ message: "저장했습니다." });
      void refreshJob();
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (
      dirty &&
      !window.confirm("저장하지 않은 변경이 있습니다. 원본으로 되돌리면 사라집니다. 계속할까요?")
    ) {
      return;
    }
    if (!confirmRestore) {
      setConfirmRestore(true);
      return;
    }
    setConfirmRestore(false);
    const r = await sendJson(`/api/jobs/${id}/artifact`, "PUT", { file, restore: true });
    if (!r.ok) {
      notifications.show({ message: r.error, color: "red" });
      return;
    }
    reloadFrame();
    notifications.show({ message: "원본으로 되돌렸습니다." });
    void refreshJob();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Paper
        px="md"
        py={10}
        radius={0}
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap="sm" wrap="nowrap">
          <Anchor
            href={`/jobs/${id}`}
            size="sm"
            onClick={(e) => {
              if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 나갈까요?"))
                e.preventDefault();
            }}
          >
            ← 작업으로
          </Anchor>
          <Text size="xs" c="dimmed" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
            {file}
            {editing && dirty ? " · 수정됨(미저장)" : ""}
          </Text>
          <SegmentedControl size="xs" value={width} onChange={setWidth} data={WIDTHS} />
          {editable && (
            <Button
              data-testid="edit-toggle"
              variant="default"
              size="compact-sm"
              onClick={toggleEdit}
            >
              {editing ? "편집 종료" : "편집"}
            </Button>
          )}
          {editing && (
            <Button
              data-testid="edit-save"
              size="compact-sm"
              onClick={save}
              loading={saving}
              disabled={!dirty}
            >
              저장
            </Button>
          )}
          {editable && hasBackup && (
            <Button
              data-testid="edit-restore"
              variant="light"
              color="red"
              size="compact-sm"
              onClick={restore}
            >
              {confirmRestore ? "정말 되돌릴까요?" : "원본으로 되돌리기"}
            </Button>
          )}
          <CopyHtmlButton src={src} />
          <Anchor href={src} target="_blank" size="sm">
            원본 열기
          </Anchor>
        </Group>
      </Paper>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          overflow: "auto",
          padding: 24,
          position: "relative", // EditPanel의 절대 위치 기준
        }}
      >
        <iframe
          key={frameNonce}
          ref={frameRef}
          data-testid="preview-frame"
          src={src}
          title="eDM preview"
          onLoad={() => {
            if (editing) enableEditing(); // restore 리로드 후에도 편집 유지
          }}
          style={{
            width: Number(width),
            minHeight: "100%",
            background: "#fff",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 10,
            transition: "width 200ms ease",
          }}
        />
        {editing && target && (
          <EditPanel key={selVersion} target={target} onChange={onInput} />
        )}
      </div>
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
