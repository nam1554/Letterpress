import { existsSync } from "node:fs";
import { Launcher } from "chrome-launcher";

/**
 * 헤드리스 Chrome 실행 파일 찾기 — 픽셀 검증(compare.py)이 쓰는 바로 그 브라우저.
 *
 * 경로를 한 곳에 박아두면 그 플랫폼 밖에서는 검증이 통째로 실패하고, 품질
 * 게이트가 "verify.json 없음"으로 정상 산출물까지 실패시킨다. 탐색은
 * chrome-launcher(Lighthouse가 쓰는 구현)에 맡긴다 — macOS·Windows·Linux의
 * 설치 위치와 레지스트리까지 이미 다루고 있다.
 */

// chrome-launcher의 탐색은 표준 위치를 벗어나면 `lsregister` 덤프까지 훑어
// 2초 넘게 블로킹한다(실측 2.4초). 이 함수는 헬스체크(60초 캐시)와 잡 시작마다
// 불리므로, 단일 스레드 서버에서 그때마다 멈추면 SSE 로그 스트림까지 함께
// 멎는다 → 프로세스 수명 동안 한 번만 찾는다.
let cached: { value: string | null } | null = null;

/** 실행 가능한 Chrome 경로. 없으면 null. */
export function findChrome(): string | null {
  if (cached) return cached.value;
  const value = resolveChrome();
  // 못 찾은 결과는 캐시하지 않는다 — 사용자가 안내대로 Chrome을 설치하고
  // "다시 점검"을 눌러도 서버를 재시작하기 전까지 계속 빨간불이면,
  // 안내 자체가 거짓말이 된다. (탐색이 느린 경우는 "찾았을 때"뿐이다.)
  if (value === null) return null;
  cached = { value };
  return value;
}

/** 테스트·환경 변경 후 다시 찾게 한다. */
export function resetChromeCache(): void {
  cached = null;
}

function resolveChrome(): string | null {
  // chrome-launcher는 CHROME_PATH를 우선 본다. 우리 문서·런처는 CHROME_BIN을
  // 쓰므로 둘 다 받아주되, 실재하는지 확인한다 — 옛 경로가 남아 있으면
  // 환경 점검은 초록불인데 검증만 조용히 실패하는 최악의 조합이 된다.
  const override = (process.env.CHROME_BIN ?? process.env.CHROME_PATH)?.trim();
  if (override && existsSync(override)) return override;
  try {
    return Launcher.getFirstInstallation() ?? null;
  } catch {
    return null; // 설치본이 하나도 없으면 던진다
  }
}
