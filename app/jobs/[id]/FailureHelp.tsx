"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button, Group, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import Section from "../../components/Section";
import { IconAlert } from "../../components/icons";
import { PROSE_WIDTH } from "../../lib/dimensions";
import { fetcher } from "../../lib/fetcher";
import { sendJson } from "../../lib/request";
import { diagnoseFailure } from "@/lib/jobs/failure";

interface BackendInfo {
  id: string;
  label: string;
  ready: boolean;
  verification: "verified" | "unverified" | "sample";
}

/**
 * 실패한 잡에 원인과 다음 행동을 붙여 준다.
 *
 * 왜: 실패 요약은 CLI 영어 원문이라 비개발자에게는 "뭘 하라는 건지 모르겠다"와
 * 같다. 게다가 가장 흔한 실패(구독 한도)가 하필 다른 구독으로 돌리면 바로
 * 풀리는 문제라, 그 한 번의 전환을 화면에서 끝낼 수 있어야 한다 — 이 앱이
 * 백엔드를 셋이나 지원하는 이유가 여기서 실현된다.
 *
 * '이어서 실행'은 헤더에 이미 있는 버튼을 글로 가리킨다. 같은 동작의 버튼을
 * 두 곳에 두면 어느 쪽이 진짜인지 묻게 된다.
 */
export default function FailureHelp({
  job,
}: {
  job: { id: string; figmaUrl: string; provider: string; summary?: string };
}) {
  const router = useRouter();
  const d = diagnoseFailure(job.summary, job.provider);
  const [retrying, setRetrying] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  // 백엔드 목록은 전환을 실제로 권할 때만 부른다 (진단은 CLI를 스폰한다).
  const { data } = useSWR<{ backends: BackendInfo[] }>(
    d.switchBackend ? "/api/setup" : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  // mock은 대안이 아니다 — 샘플만 내놓으므로 실패한 변환을 대신할 수 없다.
  const alternatives = (data?.backends ?? [])
    .filter((b) => b.id !== job.provider && b.id !== "mock")
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        Number(b.verification === "verified") - Number(a.verification === "verified"),
    );

  const choice = target ?? alternatives.find((b) => b.ready)?.id ?? alternatives[0]?.id ?? null;
  const chosen = alternatives.find((b) => b.id === choice);

  async function retryWith(providerId: string) {
    setRetrying(true);
    try {
      const r = await sendJson<{ job: { id: string } }>("/api/jobs", "POST", {
        figmaUrl: job.figmaUrl,
        provider: providerId,
      });
      if (!r.ok) {
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      router.push(`/jobs/${r.data.job.id}`);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Section
      title="무엇이 문제였나요"
      icon={<IconAlert size={16} />}
      testId="failure-help"
      mt="xl"
    >
      <Stack gap={12} maw={PROSE_WIDTH}>
        <div>
          <Text size="sm" fw={600} data-testid="failure-title">
            {d.title}
          </Text>
          <Text size="sm" c="dimmed" mt={2}>
            {d.detail}
          </Text>
        </div>

        {/* listStyle을 직접 줘야 한다 — Mantine 전역 리셋이 ul에
            `list-style: none`을 걸어서, 그냥 <ul>을 쓰면 점이 하나도 안 찍힌다
            (측정: ulListStyle="none", liDisplay="list-item").
            번호가 아니라 점인 이유: 대부분 "이것 아니면 저것"이라 순서가 없다. */}
        <ul style={{ margin: 0, paddingLeft: 20, listStyle: "disc" }}>
          {d.actions.map((a) => (
            <Text key={a} component="li" size="sm" mb={6}>
              {a}
            </Text>
          ))}
        </ul>

        {d.switchBackend && alternatives.length > 0 && (
          <div>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Select
                data-testid="retry-backend"
                label="다른 백엔드로 다시 시도"
                description="같은 Figma 링크로 새 작업을 만듭니다"
                value={choice}
                onChange={setTarget}
                data={alternatives.map((b) => ({
                  value: b.id,
                  label: `${b.label}${b.ready ? "" : " (설정 필요)"}${
                    b.verification === "verified" ? "" : " · 미검증"
                  }`,
                }))}
                allowDeselect={false}
                w={280}
              />
              <Button
                data-testid="retry-other"
                loading={retrying}
                disabled={!choice}
                onClick={() => choice && void retryWith(choice)}
              >
                이 백엔드로 실행
              </Button>
            </Group>
            {/* 준비 안 된 백엔드로 돌리면 또 실패한다 — 홈 화면과 같은 경고를
                여기서도 해준다. 막지는 않는다(사용자 판단). */}
            {chosen && !chosen.ready && (
              <Text size="xs" c="dimmed" mt={6} data-testid="retry-unready">
                이 백엔드는 아직 준비되지 않았습니다 — 홈의 <b>백엔드 연동</b>에서 남은
                단계를 먼저 끝내지 않으면 대부분 다시 실패합니다.
              </Text>
            )}
          </div>
        )}
      </Stack>
    </Section>
  );
}
