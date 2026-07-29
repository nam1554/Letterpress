import { createTheme } from "@mantine/core";

/**
 * 클로드(Anthropic) 스타일 디자인 토큰.
 * - 액센트: 테라코타 "clay" (라이트 shade 6 = #C96442, 다크 shade 5 = #CE8A64)
 * - 라이트: 오트/크림 배경 + 아이보리 페이퍼, 웜 브라운 텍스트
 * - 다크: 웜 그레이(갈색기) 스케일 — Mantine 규약상 dark.7=배경, dark.6=카드,
 *   dark.4=보더, dark.0=본문 텍스트
 * - 헤딩은 세리프(--font-serif), 본문은 산세리프 유지
 */
export const theme = createTheme({
  colors: {
    clay: [
      "#FBF6F1",
      "#F5E9DF",
      "#EDD6C5",
      "#E2BEA4",
      "#D8A583",
      "#CE8A64",
      "#C96442",
      "#B3512F",
      "#964327",
      "#78351F",
    ],
    dark: [
      "#ECEAE2",
      "#D5D2C8",
      "#A8A599",
      "#7C796D",
      "#55524A",
      "#3E3C36",
      "#30302B",
      "#262622",
      "#1E1D19",
      "#161512",
    ],
  },
  primaryColor: "clay",
  primaryShade: { light: 6, dark: 5 },
  white: "#FAF9F5",
  black: "#3D3929",
  fontFamily:
    "var(--font-geist-sans), Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, monospace",
  defaultRadius: "lg",
  headings: {
    fontFamily:
      "var(--font-serif), Georgia, 'Apple SD Gothic Neo', 'Malgun Gothic', serif",
    fontWeight: "600",
  },
});
