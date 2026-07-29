"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { Button, Code, Group, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { fetcher } from "../../lib/fetcher";
import { sendJson } from "../../lib/request";

interface HostingResult {
  created: Array<{ rel: string; replaced: number }>;
  warning?: string;
}

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
  // 저장된 템플릿은 SWR 캐시(/api/settings)에서 — 설정 패널과 캐시를 공유한다.
  const { data: settings } = useSWR<{ cdnTemplate?: string }>("/api/settings", fetcher);
  // null = 사용자가 아직 수정 안 함 → 저장된 템플릿/제목 기반 기본값 사용.
  const [templateInput, setTemplateInput] = useState<string | null>(null);
  const template = templateInput ?? settings?.cdnTemplate ?? "";
  const [folderInput, setFolderInput] = useState<string | null>(null);
  const folder = folderInput ?? `${titleSlug(jobTitle)}_${today()}`;
  const [busy, setBusy] = useState(false);

  const needsFolder = template.includes("{folder}");
  const folderInvalid = needsFolder && folder.trim() !== "" && !/^[A-Za-z0-9._-]+$/.test(folder.trim());
  const example = useMemo(
    () => (template.trim() ? previewUrl(template.trim(), folder.trim(), "hero.png") : ""),
    [template, folder],
  );

  async function create() {
    setBusy(true);
    try {
      const r = await sendJson<HostingResult>(`/api/jobs/${jobId}/hosting`, "POST", {
        template,
        folder: folder.trim(),
      });
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      const data = r.data;
      if (data.created.length === 0) {
        notifications.show({
          message: "치환할 상대경로 이미지가 없습니다 (이미 호스팅/내장된 파일들).",
          color: "yellow",
        });
      } else {
        const replaced = data.created.reduce((s, c) => s + c.replaced, 0);
        notifications.show({
          message: `hosted/ 에 ${data.created.length}개 생성 (이미지 ${replaced}건 치환)`,
          color: "teal",
        });
        if (data.warning) {
          notifications.show({ message: data.warning, color: "yellow", autoClose: 10_000 });
        }
        void mutate("/api/settings"); // 서버가 템플릿을 설정에 저장했으므로 캐시 갱신
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
          onChange={(e) => setTemplateInput(e.currentTarget.value)}
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
