"use client";

import { Button, Group, Stack, Text } from "@mantine/core";
import CommandChip from "./CommandChip";
import Section from "./Section";
import { IconCheck, IconX } from "./icons";
import { PROSE_WIDTH } from "../lib/dimensions";
import { firstRunSteps, SUBSCRIPTION_PICKS } from "../lib/first-run";

interface BackendInfo {
  id: string;
  label: string;
  ready: boolean;
}

/**
 * 처음 받은 사람이 "이걸 어떻게 하라는 거야"가 되지 않도록.
 *
 * 이전 판은 Claude Code 전용 3줄 고정 안내였다. 백엔드가 셋이 되면서 그대로
 * 두면 ChatGPT·Google 구독으로 온 팀원에게 **틀린 절차**를 보여주게 된다 —
 * 특히 Figma 접근은 백엔드마다 방법이 아예 달라서(antigravity는 커넥터 경로가
 * 없다) 뭉뚱그릴 수가 없다.
 *
 * 그래서 먼저 "어떤 구독을 갖고 계세요?"를 묻고, 고른 것의 절차만 보여준다.
 * 고르는 순간 아래 '새 변환'의 백엔드 선택도 같이 따라가므로 한 흐름으로 끝난다.
 */
export default function FirstRun({
  backendId,
  backends,
  onPick,
}: {
  backendId: string | null;
  backends: BackendInfo[] | null;
  onPick: (id: string) => void;
}) {
  const steps = backendId ? firstRunSteps(backendId) : [];
  const readyOf = (id: string) => backends?.find((b) => b.id === id)?.ready ?? null;

  return (
    <Section title="처음이신가요? 순서는 이렇습니다" testId="first-run">
      <Stack gap={14} maw={PROSE_WIDTH}>
        <div>
          <Text size="sm" fw={600}>
            어떤 구독을 갖고 계세요?
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            하나만 있으면 됩니다 — 셋 다 같은 품질 기준을 통과합니다. 고르면 아래
            준비 절차와 &lsquo;새 변환&rsquo;의 백엔드가 함께 바뀝니다.
          </Text>
          <Group gap="xs" mt={8}>
            {SUBSCRIPTION_PICKS.map((p) => {
              const ready = readyOf(p.id);
              return (
                <Button
                  key={p.id}
                  data-testid={`first-run-pick-${p.id}`}
                  size="compact-sm"
                  variant={backendId === p.id ? "filled" : "default"}
                  onClick={() => onPick(p.id)}
                  leftSection={
                    // 준비 상태는 백엔드 연동 카드와 같은 표시를 쓴다.
                    ready === null ? undefined : ready ? (
                      <IconCheck size={12} />
                    ) : (
                      <IconX size={12} />
                    )
                  }
                >
                  {p.subscription}
                </Button>
              );
            })}
          </Group>
        </div>

        {steps.length > 0 && (
          <Stack gap={10} data-testid="first-run-steps">
            {steps.map((s, i) => (
              <div key={s.title}>
                <Text size="sm">
                  <b>
                    {i + 1}. {s.title}
                  </b>
                </Text>
                <Text size="sm" c="dimmed" mt={2}>
                  {s.body}
                </Text>
                {s.command && <CommandChip command={s.command} />}
              </div>
            ))}
          </Stack>
        )}

        <Text size="xs" c="dimmed">
          어디서 막히든 <b>문제 신고용 파일 내려받기</b>를 눌러 받은 파일을 담당자에게
          보내주시면 됩니다 — 무엇이 문제인지 직접 알아낼 필요 없습니다.
        </Text>
      </Stack>
    </Section>
  );
}
