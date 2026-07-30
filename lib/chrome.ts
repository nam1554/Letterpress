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
// 2초 넘게 블로킹한다(실측 2.4초). 이 함수는 헬스체크(60초 캐시)와 잡 시작,
// 게이트 측정마다 불리므로, 단일 스레드 서버에서 그때마다 멈추면 SSE 로그
// 스트림까지 함께 멎는다 → 결과를 캐시한다.
//
// **못 찾은 결과도 캐시한다.** macOS에서 느린 경로는 오히려 "못 찾을 때"다:
// chrome-launcher의 darwinFast()는 표준 경로가 있을 때만 즉시 반환하고, 없으면
// darwin()으로 내려가 `lsregister -dump | grep`을 execSync로 돌린다
// (node_modules/chrome-launcher/dist/chrome-finder.js). 즉 미설치 머신에서
// 캐시를 안 하면 헬스 폴링마다 서버가 몇 초씩 얼어붙는다.
// 대신 짧은 TTL을 둬서 사용자가 Chrome을 설치하고 기다리면 저절로 풀리고,
// "다시 점검"(runHealthChecks(force))은 즉시 resetChromeCache()로 지운다.
const MISS_TTL_MS = 60_000;
let cached: { value: string | null; at: number } | null = null;

/** 실행 가능한 Chrome 경로. 없으면 null. */
export function findChrome(): string | null {
  const now = Date.now();
  if (cached && (cached.value !== null || now - cached.at < MISS_TTL_MS)) return cached.value;
  const value = resolveChrome();
  cached = { value, at: now };
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
