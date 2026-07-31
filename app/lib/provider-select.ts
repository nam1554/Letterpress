/**
 * 홈 화면의 백엔드 Select 라벨 조립 — 두 독립 축을 각각 마크로 붙인다:
 * "설정 필요"(ready=false, lib/setup.ts 진단) · "미검증"(verification=unverified,
 * lib/providers/types.ts). app/page.tsx의 인라인 로직이었다 — 순수 함수로
 * 뽑아내 브라우저 없이 유닛 테스트할 수 있게 한다.
 */

export interface SelectableProvider {
  id: string;
  label: string;
  verification: "verified" | "unverified" | "sample";
}

export interface SelectableBackend {
  id: string;
  ready: boolean;
}

/** Select `data`의 한 옵션 라벨. 마크가 없으면 프로바이더 라벨 그대로. */
export function providerOptionLabel(
  provider: SelectableProvider,
  backend: SelectableBackend | undefined,
): string {
  const marks = [
    backend && !backend.ready ? "설정 필요" : null,
    provider.verification === "unverified" ? "미검증" : null,
  ].filter((m): m is string => m !== null);
  return marks.length ? `${provider.label} · ${marks.join(" · ")}` : provider.label;
}
