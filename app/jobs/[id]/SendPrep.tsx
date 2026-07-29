"use client";

import { useEffect, useState } from "react";
import { Button, Code, Group, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";

/**
 * 발송 준비: 상대경로 이미지를 CDN URL로 치환한 교체본(hosted/)을 만든다.
 * 템플릿은 서버 설정에 저장돼 팀에서 재사용된다.
 */
export default function SendPrep({
  jobId,
  onCreated,
}: {
  jobId: string;
  onCreated: () => void;
}) {
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.cdnTemplate) setTemplate(s.cdnTemplate);
      })
      .catch(() => {});
  }, []);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/hosting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
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
        치환한 발송용 HTML을 만듭니다. 플레이스홀더: <Code>{"{file}"}</Code>
        (hero.jpg) · <Code>{"{name}"}</Code>(hero) · <Code>{"{ext}"}</Code>(jpg)
      </Text>
      <Group mt="sm" gap="sm" wrap="nowrap">
        <TextInput
          data-testid="cdn-template"
          value={template}
          onChange={(e) => setTemplate(e.currentTarget.value)}
          placeholder="https://cdn.example.com/edm/{file}"
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: "var(--font-geist-mono)", fontSize: 13 } }}
        />
        <Button data-testid="cdn-create" onClick={create} loading={busy} disabled={!template.trim()}>
          교체본 생성
        </Button>
      </Group>
    </Paper>
  );
}
