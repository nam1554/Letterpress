"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { Button, Code, Group, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { fetcher } from "../../lib/fetcher";
import { requestJson, sendJson } from "../../lib/request";
import CommandChip from "../../components/CommandChip";
import Section from "../../components/Section";
import { PROSE_WIDTH } from "../../lib/dimensions";

interface HostingResult {
  created: Array<{ rel: string; replaced: number }>;
  warning?: string;
}

interface UrlCheck {
  file: string;
  url: string;
  uploadKey: string | null;
  state: "live" | "missing" | "unreachable";
  status: number | null;
}

interface CheckSummary {
  checks: UrlCheck[];
  live: number;
  missing: number;
  unreachable: number;
  allUnreachable: boolean;
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
  const [check, setCheck] = useState<CheckSummary | null>(null);
  const [checking, setChecking] = useState(false);

  // 업로드는 수동이다(자격증명을 배포하지 않기로 한 결정) — 앱은 각 CDN URL이
  // 실제로 살아 있는지만 서버에서 확인해 준다.
  async function runCheck() {
    setChecking(true);
    try {
      const r = await requestJson<CheckSummary>(`/api/jobs/${jobId}/hosting/check`);
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      setCheck(r.data);
    } finally {
      setChecking(false);
    }
  }

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
        void runCheck(); // 교체본이 새로 생겼으니 업로드 상태를 바로 보여준다
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="발송 준비">
      <Text size="xs" c="dimmed" maw={PROSE_WIDTH}>
        images/ 폴더를 CDN에 올린 뒤, 아래 URL 템플릿으로 <Code>src</Code>를 일괄
        치환한 발송용 HTML을 만듭니다. 플레이스홀더: <Code>{"{folder}"}</Code>
        (캠페인 폴더) · <Code>{"{file}"}</Code>(hero.jpg) · <Code>{"{name}"}</Code>
        (hero) · <Code>{"{ext}"}</Code>(jpg)
      </Text>
      <Group mt="md" gap="sm" wrap="nowrap" align="flex-start">
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
      <Group mt="md">
        <Button
          data-testid="cdn-create"
          onClick={create}
          loading={busy}
          disabled={!template.trim() || (needsFolder && (!folder.trim() || folderInvalid))}
        >
          교체본 생성
        </Button>
        <Button data-testid="cdn-recheck" variant="default" onClick={runCheck} loading={checking}>
          CDN 업로드 확인
        </Button>
      </Group>

      {check && (
        <div data-testid="cdn-check-result" style={{ marginTop: 14 }}>
          {check.allUnreachable ? (
            <Text size="sm" c="yellow">
              CDN에 연결할 수 없습니다 — 사내망/VPN 연결을 확인하세요. (이미지{" "}
              {check.checks.length}개를 확인하지 못했습니다. 미업로드라는 뜻이 아닙니다.)
            </Text>
          ) : (
            <>
              <Text
                size="sm"
                fw={600}
                c={check.missing === 0 && check.unreachable === 0 ? "green" : undefined}
              >
                {check.missing === 0 && check.unreachable === 0
                  ? `CDN 이미지 ${check.live}/${check.checks.length} 확인됨 — 발송 준비 완료`
                  : `CDN 확인: 정상 ${check.live} · 미업로드 ${check.missing}${
                      check.unreachable > 0 ? ` · 확인 불가 ${check.unreachable}` : ""
                    }`}
              </Text>
              {check.missing > 0 && (
                <>
                  <Text size="xs" c="dimmed" mt={6} maw={PROSE_WIDTH}>
                    아래 파일이 아직 CDN에 없습니다. images/ 폴더의 파일을{" "}
                    {check.checks.some((c) => c.uploadKey)
                      ? "다음 오브젝트 이름으로 올린 뒤"
                      : "CDN에 올린 뒤"}{" "}
                    다시 확인을 누르세요.
                  </Text>
                  {check.checks
                    .filter((c) => c.state === "missing")
                    .map((c) =>
                      c.uploadKey ? (
                        <CommandChip key={c.file} command={c.uploadKey} />
                      ) : (
                        <Text key={c.file} size="xs" ff="monospace" mt={4}>
                          {c.file}
                        </Text>
                      ),
                    )}
                </>
              )}
              {check.unreachable > 0 && check.missing === 0 && (
                <Text size="xs" c="dimmed" mt={4}>
                  일부 이미지는 시간 안에 응답이 없어 확인하지 못했습니다 — 다시 확인을
                  눌러보세요.
                </Text>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
