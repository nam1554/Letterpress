"use client";

import { Button, Code, CopyButton, Group } from "@mantine/core";

/**
 * 터미널에 붙여넣을 명령 한 줄 + 복사 버튼.
 *
 * 백엔드 연동 카드와 첫 실행 안내가 같은 성격의 명령을 보여준다 — 두 곳에서
 * 모양이 갈리면 "이건 저기 그거랑 같은 건가?"를 묻게 되므로 하나로 둔다.
 */
export default function CommandChip({ command }: { command: string }) {
  return (
    <Group gap={6} mt={4} wrap="nowrap">
      <Code style={{ fontSize: 11, overflowX: "auto" }}>{command}</Code>
      <CopyButton value={command}>
        {({ copied, copy }) => (
          <Button size="compact-xs" variant="subtle" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
