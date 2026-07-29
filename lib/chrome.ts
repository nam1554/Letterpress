import { Launcher } from "chrome-launcher";

/**
 * 헤드리스 Chrome 실행 파일 찾기 — 픽셀 검증(compare.py)이 쓰는 바로 그 브라우저.
 *
 * 경로를 한 곳에 박아두면 그 플랫폼 밖에서는 검증이 통째로 실패하고, 품질
 * 게이트가 "verify.json 없음"으로 정상 산출물까지 실패시킨다. 탐색은
 * chrome-launcher(Lighthouse가 쓰는 구현)에 맡긴다 — macOS·Windows·Linux의
 * 설치 위치와 레지스트리까지 이미 다루고 있다.
 */

/** 실행 가능한 Chrome 경로. 없으면 null. */
export function findChrome(): string | null {
  try {
    // chrome-launcher는 CHROME_PATH를 우선 본다. 우리 문서·런처는 CHROME_BIN을
    // 쓰므로 둘 다 받아준다.
    const override = (process.env.CHROME_BIN ?? process.env.CHROME_PATH)?.trim();
    if (override) return override;
    return Launcher.getFirstInstallation() ?? null;
  } catch {
    return null; // 설치본이 하나도 없으면 던진다
  }
}
