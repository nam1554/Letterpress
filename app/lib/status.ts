/**
 * 잡 상태의 단일 출처. 홈과 작업 상세가 각자 `STATUS_BADGE` 맵을 들고 있어서
 * 라벨이 두 곳에서 따로 늙을 수 있었다 — 상태 표현을 한 곳으로 모은다.
 *
 * 색 이름은 Mantine 팔레트 키다(theme.ts에서 저채도 어스톤으로 덮여 있다):
 * green=세이지, red=옥스블러드, blue=슬레이트, gray=웜 그레이.
 */
export interface StatusMeta {
  color: string;
  label: string;
}

const STATUS: Record<string, StatusMeta> = {
  queued: { color: "gray", label: "대기" },
  running: { color: "blue", label: "실행 중" },
  succeeded: { color: "green", label: "완료" },
  failed: { color: "red", label: "실패" },
};

/** 알 수 없는 상태값이 와도 화면이 비지 않게 원문을 라벨로 쓴다. */
export function statusMeta(status: string): StatusMeta {
  return STATUS[status] ?? { color: "gray", label: status };
}

/** 대기·실행 중 = 아직 끝나지 않음. */
export function isActive(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}
