"use client";

import { Button, Group, Paper, Text } from "@mantine/core";
import { rgbToHex } from "./color";

export interface PanelTarget {
  el: HTMLElement;
  /** 스크롤 컨테이너 기준 절대 좌표 (요소 좌상단). */
  left: number;
  top: number;
}

/**
 * 선택 요소의 인라인 스타일을 고치는 미니 패널. 부모 페이지에 절대 위치로 뜬다.
 * onMouseDown preventDefault — 패널 클릭이 iframe 포커스/선택을 뺏으면 안 된다.
 */
export default function EditPanel({
  target,
  onChange,
}: {
  target: PanelTarget;
  onChange: () => void;
}) {
  const { el } = target;
  const view = el.ownerDocument.defaultView;

  // el은 iframe 문서 안의 실제 DOM 요소 — React가 관리하지 않는 외부 시스템이라
  // 인라인 스타일을 직접 고쳐도 안전하다 (컴파일러의 props-불변성 규칙은 오탐).
  function bumpFontSize(delta: number) {
    if (!view) return;
    const size = parseFloat(view.getComputedStyle(el).fontSize) || 14;
    // eslint-disable-next-line react-hooks/immutability
    el.style.fontSize = `${Math.max(8, size + delta)}px`;
    onChange();
  }
  function toggleBold() {
    if (!view) return;
    const weight = parseInt(view.getComputedStyle(el).fontWeight, 10) || 400;
    // eslint-disable-next-line react-hooks/immutability
    el.style.fontWeight = weight >= 600 ? "400" : "700";
    onChange();
  }

  const computed = view?.getComputedStyle(el);
  return (
    <Paper
      shadow="md"
      p={6}
      radius="md"
      withBorder
      data-testid="edit-panel"
      style={{ position: "absolute", left: target.left, top: Math.max(0, target.top - 48), zIndex: 10 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Group gap={8} wrap="nowrap">
        <Text size="xs" c="dimmed" ff="monospace">
          {el.tagName.toLowerCase()}
        </Text>
        <Button variant="default" size="compact-xs" fw={700} onClick={toggleBold}>
          B
        </Button>
        <Button variant="default" size="compact-xs" onClick={() => bumpFontSize(-1)}>
          A−
        </Button>
        <Button variant="default" size="compact-xs" onClick={() => bumpFontSize(1)}>
          A＋
        </Button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          글자
          <input
            type="color"
            defaultValue={(computed && rgbToHex(computed.color)) ?? "#000000"}
            onChange={(e) => {
              // eslint-disable-next-line react-hooks/immutability
              el.style.color = e.currentTarget.value;
              onChange();
            }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          배경
          <input
            type="color"
            // 투명 배경은 흰색으로 보여준다 — 잘못 확정해도 eDM 배경과 사실상
            // 동일하고, 검정처럼 파괴적으로 저장되지 않는다.
            defaultValue={(computed && rgbToHex(computed.backgroundColor)) ?? "#ffffff"}
            onChange={(e) => {
              // eslint-disable-next-line react-hooks/immutability
              el.style.backgroundColor = e.currentTarget.value;
              onChange();
            }}
          />
        </label>
      </Group>
    </Paper>
  );
}
