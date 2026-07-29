"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Code, Group, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";

// 클라이언트 미리보기용 — 서버의 renderCdnUrl과 같은 치환 규칙 (lib/hosting.ts)
function previewUrl(template: string, folder: string, file: string): string {
  const ext = file.split(".").pop() ?? "";
  const name = file.slice(0, file.length - ext.length - 1);
  return template
    .replaceAll("{folder}", folder || "{folder}")
    .replaceAll("{file}", file)
    .replaceAll("{name}", name)
    .replaceAll("{ext}", ext);
}

/** 잡 제목 → URL 안전 슬러그 (한글 등 비ASCII는 제거). */
function titleSlug(title?: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "edm";
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 발송 준비: 상대경로 이미지를 CDN URL로 치환한 교체본(hosted/)을 만든다.
 * 템플릿({folder} 포함)은 설정에 저장돼 재사용하고, 폴더명은 캠페인마다
 * 새로 입력한다 — 지난 발송본 이미지를 덮어쓰지 않기 위한 네임스페이스.
 */
export default function SendPrep({
  jobId,
  jobTitle,
  onCreated,
}: {
  jobId: string;
  jobTitle?: string;
  onCreated: () => void;
}) {
  const [template, setTemplate] = useState("");
  // null = 사용자가 아직 수정 안 함 → 제목 기반 기본값 사용 (제목이 늦게 로드돼도 반영됨)
  const [folderInput, setFolderInput] = useState<string | null>(null);
  const folder = folderInput ?? `${titleSlug(jobTitle)}_${today()}`;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.cdnTemplate) setTemplate(s.cdnTemplate);
      })
      .catch(() => {});
  }, []);

  const needsFolder = template.includes("{folder}");
  const folderInvalid = needsFolder && folder.trim() !== "" && !/^[A-Za-z0-9._-]+$/.test(folder.trim());
  const example = useMemo(
    () => (template.trim() ? previewUrl(template.trim(), folder.trim(), "hero.png") : ""),
    [template, folder],
  );

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/hosting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, folder: folder.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({ message: data.error ?? "생성 실패", color: "red" });
        return;
      }
      if (data.created.length === 0) {
        notifications.show({
          message: "치환할 상대경로 이미지가 없습니다 (이미 호스팅/내장된 파일들).",
          color: "yellow",
        });
      } else {
        const replaced = data.created.reduce(
          (s: number, c: { replaced: number }) => s + c.replaced,
          0,
        );
        notifications.show({
          message: `hosted/ 에 ${data.created.length}개 생성 (이미지 ${replaced}건 치환)`,
          color: "teal",
        });
        if (data.warning) {
          notifications.show({ message: data.warning, color: "yellow", autoClose: 10_000 });
        }
        onCreated();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="lg" mt={36}>
      <Title order={2} size="h6">
        발송 준비 — CDN 교체본
      </Title>
      <Text size="xs" c="dimmed" mt={4}>
        images/ 폴더를 CDN에 올린 뒤, 아래 URL 템플릿으로 <Code>src</Code>를 일괄
        치환한 발송용 HTML을 만듭니다. 플레이스홀더: <Code>{"{folder}"}</Code>
        (캠페인 폴더) · <Code>{"{file}"}</Code>(hero.jpg) · <Code>{"{name}"}</Code>
        (hero) · <Code>{"{ext}"}</Code>(jpg)
      </Text>
      <Group mt="sm" gap="sm" wrap="nowrap" align="flex-start">
        <TextInput
          data-testid="cdn-template"
          label="URL 템플릿 (설정에 저장돼 재사용)"
          value={template}
          onChange={(e) => setTemplate(e.currentTarget.value)}
          placeholder="https://cdn.example.com/iiif/3/{folder}__{file}/full/max/0/default.{ext}"
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: "var(--font-geist-mono)", fontSize: 13 } }}
        />
        <TextInput
          data-testid="cdn-folder"
          label="캠페인 폴더명"
          value={folder}
          onChange={(e) => setFolderInput(e.currentTarget.value)}
          placeholder={`aisurfer_edm_${today()}`}
          disabled={!needsFolder}
          error={folderInvalid ? "영문·숫자·._- 만 사용" : undefined}
          w={240}
          styles={{ input: { fontFamily: "var(--font-geist-mono)", fontSize: 13 } }}
        />
      </Group>
      {!needsFolder && template.trim() !== "" && (
        <Text size="xs" c="dimmed" mt={6}>
          템플릿에 <Code>{"{folder}"}</Code>를 넣으면 캠페인 폴더명이 적용됩니다 — 캠페인마다
          폴더를 나누면 지난 발송본 이미지를 덮어쓸 위험이 없습니다.
        </Text>
      )}
      {example && (
        <Text size="xs" c="dimmed" mt={6} ff="monospace" style={{ wordBreak: "break-all" }}>
          예시 (hero.png): {example}
        </Text>
      )}
      <Group mt="sm">
        <Button
          data-testid="cdn-create"
          onClick={create}
          loading={busy}
          disabled={!template.trim() || (needsFolder && (!folder.trim() || folderInvalid))}
        >
          교체본 생성
        </Button>
      </Group>
    </Paper>
  );
}
