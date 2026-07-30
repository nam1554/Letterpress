/**
 * 인라인 SVG 아이콘 — 화면에 흩어져 있던 이모지(🔌 ⚙️ 🔔 🔕 ✓ △ ✗)를 대체한다.
 * 이모지는 OS·폰트마다 제각각 렌더되고 (macOS에선 컬러 이모지, Windows에선 다른
 * 글리프) 크기·정렬을 맞출 수 없어서, 정돈된 화면에서 가장 먼저 눈에 걸리는
 * "미완성" 신호였다.
 *
 * 왜 아이콘 라이브러리를 안 쓰는가: @tabler/icons-react가 설치돼 있지 않고,
 * 글리프 8개는 새 의존성을 정당화하지 못한다. 전부 `currentColor` +
 * 24×24 뷰박스라 `color`/`size`만으로 제어된다.
 */

interface IconProps {
  size?: number;
  /** 장식용이 아니라 의미를 가질 때만 지정 — 없으면 aria-hidden 처리된다. */
  label?: string;
}

function svgProps({ size = 16, label }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    // 라벨이 없으면 스크린리더에서 감춘다 (옆 텍스트가 이미 의미를 전달).
    ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true }),
    style: { flexShrink: 0, display: "block" },
  };
}

/** ⚙️ 설정 */
export function IconSettings(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * 🔌 백엔드 연동.
 * 뷰박스 폭을 최대한 쓴다(x 4.5~19.5) — 처음엔 x 6~18만 써서 15px로 그렸을 때
 * 실제 글리프가 7px 남짓밖에 안 돼 알아볼 수 없는 실선 뭉치로 보였다.
 */
export function IconPlug(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 2v5" />
      <path d="M16 2v5" />
      <path d="M4.5 7h15v3.5a7.5 7.5 0 0 1-15 0z" />
      <path d="M12 18.5V22" />
    </svg>
  );
}

/** 🔔 완료 시 알림 켜짐 */
export function IconBell(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** 🔕 완료 시 알림 꺼짐 */
export function IconBellOff(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8.7 3A6 6 0 0 1 18 8c0 7 3 9 3 9H6" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      <path d="M3 3l18 18" />
      <path d="M6 8a6 6 0 0 1 .3-1.9C6.1 6.7 6 7.3 6 8c0 7-3 9-3 9h4" />
    </svg>
  );
}

/** ✓ 통과 / 성공 */
export function IconCheck(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** ✗ 실패 */
export function IconX(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

/** △ 경고 */
export function IconAlert(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** 다운로드 */
export function IconDownload(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

/** 알 수 없음 / 미확인 (진단 단계의 `?`) */
export function IconQuestion(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}
