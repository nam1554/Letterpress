import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * 클로드(Anthropic) 스타일 디자인 토큰.
 *
 * 핵심 규칙: 이 앱의 뉴트럴은 전부 **웜**이다. Mantine 기본 `gray`는 블루그레이
 * (#868e96 / #ced4da)라서 크림 배경 + 테라코타 액센트와 색온도가 충돌한다.
 * `gray`를 덮지 않으면 dimmed 텍스트·모든 보더·모든 Divider·placeholder가
 * 쿨로 남아 화면 전체가 어색해진다 — 실제로 그게 원래 증상이었다.
 *
 * 상태색(green/red/blue/yellow)도 Mantine 기본은 고채도라 저채도 액센트 하나와
 * 경쟁한다. 여기서 저채도 어스톤으로 덮으면 기존 `color="green"` 호출부를
 * 고치지 않고도 화면 전체가 한 팔레트로 정렬된다.
 *
 * 대비는 전부 WCAG 상대휘도로 계산해 확정했다
 * (docs/superpowers/specs/2026-07-30-ui-refresh-design.md에 수치 기록).
 * 라이트 페이지 #F0EEE6 / 라이트 카드 #FAF9F5 / 다크 페이지 #1E1D19 /
 * 다크 카드 #262622 기준.
 */

/** 웜 그레이 — 라이트 스킴의 모든 뉴트럴이 여기서 나온다. */
const warmGray: MantineColorsTuple = [
  "#F7F5F0",
  "#EDEAE1",
  "#E0DCD0", // hairline
  "#CFCABB", // divider
  "#B7B1A1", // input border
  "#948D7D", // placeholder
  "#6E6857", // dimmed — 페이지 위 4.78, 카드 위 5.27 (AA)
  "#574F42",
  "#423C32",
  "#2E2A23",
];

/**
 * 테라코타 액센트. shade 7(#BE5836)이 primary fill —
 * 흰 라벨 대비 4.53으로 AA를 통과하는 가장 밝은 단계다. shade 6(#C96442)은
 * 3.90으로 미달이고, 그게 primary 버튼이 비활성처럼 보였던 이유다.
 */
const clay: MantineColorsTuple = [
  "#FBF6F1",
  "#F5E9DF",
  "#EDD6C5",
  "#E2BEA4",
  "#D8A583",
  "#CE8A64", // 다크 스킴 앵커 — 다크 카드 위 5.38
  "#C96442",
  "#BE5836", // primary fill (양쪽 스킴 공용)
  "#A64828", // 라이트 스킴 앵커 — 아이보리 위 5.57
  "#883A20",
];

/**
 * 웜 그레이 다크 스케일. Mantine 규약상 dark.7이 카드(= --mantine-color-body),
 * dark.8이 페이지 배경이다. Paper는 배경을 --mantine-color-body에서 가져오므로
 * 페이지 배경은 globals.css에서 body에 직접 칠한다 — 그러지 않으면 카드와
 * 페이지가 같은 색이 되어 레이어가 사라진다(원래 증상).
 */
const warmDark: MantineColorsTuple = [
  "#ECEAE2", // 본문 텍스트
  "#D5D2C8",
  "#A8A599", // dimmed — 다크 카드 위 6.15
  "#7C796D",
  "#55524A", // 보더
  "#3E3C36",
  "#30302B",
  "#262622", // 카드
  "#1E1D19", // 페이지
  "#161512",
];

/** 완료 — 세이지/올리브. */
const sage: MantineColorsTuple = [
  "#F0F3EA",
  "#E0E7D4",
  "#C7D3B4",
  "#ADBE93", // 다크 카드 위 7.64
  "#94A876",
  "#7C925E",
  "#64794A",
  "#485832", // 배지 텍스트 — sage.1 위 6.09
  "#3D4C2C",
  "#2C3820",
];

/**
 * 실패 — 옥스블러드. 테라코타 액센트(#BE5836)보다 의도적으로 더 깊게 둔다.
 * 그러지 않으면 "실패"가 primary CTA처럼 읽힌다.
 */
const oxblood: MantineColorsTuple = [
  "#F8EDEA",
  "#F1D9D3",
  "#E2B4A9",
  "#D08E7F", // 다크 카드 위 5.68
  "#BC6C59",
  "#A5503C",
  "#8C3E2C",
  "#73301F", // 배지 텍스트 — oxblood.1 위 7.19
  "#5C2517",
  "#451B10",
];

/** 실행 중 — 저채도 슬레이트. 화면에서 유일하게 허용한 쿨 노트. */
const slate: MantineColorsTuple = [
  "#EEF0F4",
  "#DCE0E9",
  "#BCC3D2",
  "#9CA6BB", // 다크 카드 위 6.21
  "#7F8BA4",
  "#67738D",
  "#545F78",
  "#444D62", // 배지 텍스트 — slate.1 위 6.39
  "#363D4E",
  "#282E3B",
];

/** 경고 — 오커/머스터드. */
const ochre: MantineColorsTuple = [
  "#FAF3E2",
  "#F3E5C4",
  "#E6CE93",
  "#D7B663", // 다크 카드 위 7.78
  "#C6A043",
  "#AC8931",
  "#8E7026",
  "#6A5119", // 배지 텍스트 — ochre.1 위 6.00
  "#5C4717",
  "#453510",
];

export const theme = createTheme({
  colors: {
    clay,
    gray: warmGray,
    dark: warmDark,
    green: sage,
    red: oxblood,
    blue: slate,
    yellow: ochre,
    // teal은 알림(notifications)에서 성공색으로 쓰인다 — sage와 맞춰 둔다.
    teal: sage,
  },
  primaryColor: "clay",
  primaryShade: 7,
  white: "#FAF9F5",
  black: "#3D3929",
  fontFamily:
    "var(--font-geist-sans), Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, monospace",

  // 4단 타입 스케일: 12 meta · 14 body · 17 섹션 타이틀 · 24 페이지 타이틀.
  fontSizes: {
    xs: "0.75rem", // 12
    sm: "0.875rem", // 14
    md: "1rem", // 16
    lg: "1.0625rem", // 17
    xl: "1.5rem", // 24
  },
  lineHeights: {
    xs: "1.5",
    sm: "1.6",
    md: "1.6",
    lg: "1.45",
    xl: "1.25",
  },

  // 16px 라운드가 20px 높이 Badge에까지 걸려 화면이 알약처럼 보였다.
  radius: {
    xs: "0.1875rem", // 3
    sm: "0.3125rem", // 5
    md: "0.5rem", // 8
    lg: "0.75rem", // 12
    xl: "1.125rem", // 18
  },
  defaultRadius: "md",

  headings: {
    fontFamily:
      "var(--font-serif), Georgia, 'Apple SD Gothic Neo', 'Malgun Gothic', serif",
    fontWeight: "600",
    sizes: {
      // 세리프는 페이지 타이틀(24)과 섹션 타이틀(17)에만 쓴다.
      h1: { fontSize: "1.5rem", lineHeight: "1.25" },
      h2: { fontSize: "1.0625rem", lineHeight: "1.45" },
      h3: { fontSize: "0.9375rem", lineHeight: "1.45" },
      h4: { fontSize: "0.875rem", lineHeight: "1.5" },
      h5: { fontSize: "0.8125rem", lineHeight: "1.5" },
      h6: { fontSize: "0.75rem", lineHeight: "1.5" },
    },
  },

  // 왜 `Badge.extend({...})`가 아니라 평범한 객체인가: Mantine v9에서 컴포넌트의
  // `.extend`는 타입 추론용 헬퍼일 뿐이고 런타임에선 `identity`다. 게다가
  // Turbopack ESM 경로에서 `Badge.extend is not a function`으로 터진다
  // (타입은 통과하므로 typecheck로는 안 잡히고 첫 렌더에서 500이 된다).
  // 평범한 객체가 같은 결과를 내면서 그 의존을 없앤다.
  components: {
    // 작은 칩에 16px 라운드가 걸리면 알약이 된다 — 태그처럼 보이게 sm 고정.
    // textTransform: Mantine 기본값이 uppercase라 "GEMINI 설정 필요"처럼
    // 한글·영문 혼용 라벨이 소리치는 모양이 된다.
    Badge: {
      defaultProps: { radius: "sm" },
      styles: { label: { textTransform: "none" as const, fontWeight: 600 } },
    },
    // 카드는 페이지보다 한 단계 밝은 서피스다 (globals.css의 레이어링 참고).
    Paper: { defaultProps: { radius: "lg" } },
  },
});
