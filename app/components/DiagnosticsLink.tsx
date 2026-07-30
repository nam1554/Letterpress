"use client";

import { Anchor, Stack, Text, Tooltip } from "@mantine/core";

/**
 * "문제 신고용 파일" 링크 — 막힌 사용자가 `data/` 폴더를 뒤지지 않고 압축 파일
 * 하나만 전달하면 되게 만든 장치다. 홈과 잡 페이지가 같은 문구를 쓰도록
 * 컴포넌트로 묶었다 (설명이 두 곳에서 따로 늙는 것을 막는다).
 *
 * 왜 Mantine Tooltip인가: 브라우저 기본 `title` 툴팁은 뜨기까지 1초 이상
 * 걸리고(브라우저 고정값이라 조절할 수 없다) 줄바꿈도 안 된다. 정작 이 링크는
 * "뭔지 모르겠는데 눌러도 되나?" 싶을 때 읽히는 설명이라 즉시 보여야 한다.
 * 마우스뿐 아니라 키보드 포커스·터치에서도 뜨게 해 둔다.
 */
export default function DiagnosticsLink({ jobId }: { jobId?: string }) {
  return (
    <Tooltip
      multiline
      w={320}
      withArrow
      // 위로 열면 바로 위의 ⚙️ 설정·🔌 백엔드 연동 패널을 덮는다.
      position="bottom-end"
      openDelay={100}
      events={{ hover: true, focus: true, touch: true }}
      label={
        <Stack gap={4}>
          <Text size="xs" fw={700}>
            막히면 이 파일 하나만 보내주세요
          </Text>
          <Text size="xs">
            {jobId
              ? "이 작업이 어디서 멈췄는지, 어떤 프로그램이 깔려 있는지를 압축 파일 하나에 담아 저장합니다."
              : "어떤 프로그램이 깔려 있는지와 그동안 생긴 오류 기록을 압축 파일 하나에 담아 저장합니다."}{" "}
            받은 파일을 메일이나 메신저에 그대로 첨부하면 됩니다 — 폴더를 찾아다닐 필요가
            없습니다.
          </Text>
          <Text size="xs">비밀번호·API 키·토큰은 담기지 않습니다.</Text>
        </Stack>
      }
    >
      <Anchor
        href={jobId ? `/api/diagnostics?job=${jobId}` : "/api/diagnostics"}
        size="xs"
        c="dimmed"
        data-testid="diagnostics"
      >
        문제 신고용 파일 내려받기
      </Anchor>
    </Tooltip>
  );
}
