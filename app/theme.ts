import { createTheme } from "@mantine/core";

/**
 * 기존 디자인 시스템의 페트롤(딥 틸) 액센트를 Mantine 팔레트로 이식.
 * shade 6 = 라이트 기본(#0E7A6E), shade 4 = 다크 기본(#3AB5A6 근사).
 */
export const theme = createTheme({
  colors: {
    petrol: [
      "#E6F4F2",
      "#CBE9E4",
      "#A3D8D0",
      "#74C4B8",
      "#3AB5A6",
      "#23A090",
      "#0E7A6E",
      "#0B665C",
      "#09544C",
      "#06443D",
    ],
  },
  primaryColor: "petrol",
  primaryShade: { light: 6, dark: 4 },
  fontFamily:
    "var(--font-geist-sans), Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, monospace",
  defaultRadius: "md",
  headings: {
    fontWeight: "700",
  },
});
