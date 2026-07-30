import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chrome이 설치돼 있지 않은 환경(새 클론·CI)만 따로 검증한다 — 실제 탐색을
 * 쓰는 chrome.test.ts와 섞을 수 없어 파일을 나눴다.
 *
 * 왜 중요한가: macOS에서 **느린 경로는 "못 찾을 때"다.** chrome-launcher의
 * darwinFast()는 표준 경로가 있을 때만 즉시 반환하고, 없으면 `lsregister -dump`
 * 를 execSync로 돌린다(실측 2.4초, 이벤트 루프 블로킹). findChrome()은 헬스
 * 폴링·잡 시작·게이트 측정마다 불리므로 미설치 머신에서 캐시가 없으면 서버가
 * 주기적으로 얼어붙는다.
 */
// vi.mock 팩토리는 파일 맨 위로 끌어올려지므로 최상위 변수를 참조할 수 없다 —
// vi.hoisted로 함께 끌어올린다.
const { getFirstInstallation } = vi.hoisted(() => ({
  getFirstInstallation: vi.fn(() => {
    throw new Error("no chrome installed");
  }),
}));
vi.mock("chrome-launcher", () => ({ Launcher: { getFirstInstallation } }));

import { findChrome, resetChromeCache } from "./chrome";

const originalBin = process.env.CHROME_BIN;
const originalPath = process.env.CHROME_PATH;

beforeEach(() => {
  delete process.env.CHROME_BIN;
  delete process.env.CHROME_PATH;
  getFirstInstallation.mockClear();
  resetChromeCache();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalBin === undefined) delete process.env.CHROME_BIN;
  else process.env.CHROME_BIN = originalBin;
  if (originalPath === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = originalPath;
  resetChromeCache();
});

describe("Chrome을 찾지 못하는 환경", () => {
  it("못 찾은 결과도 캐시한다 (미탐색이 곧 lsregister 덤프다)", () => {
    for (let i = 0; i < 50; i++) expect(findChrome()).toBeNull();
    expect(getFirstInstallation).toHaveBeenCalledTimes(1);
  });

  it("TTL이 지나면 다시 찾는다 (설치하고 기다리면 저절로 풀린다)", () => {
    vi.useFakeTimers();
    expect(findChrome()).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(findChrome()).toBeNull();
    expect(getFirstInstallation).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    expect(findChrome()).toBeNull();
    expect(getFirstInstallation).toHaveBeenCalledTimes(2);
  });

  it("resetChromeCache()는 즉시 다시 찾게 한다 (다시 점검 버튼)", () => {
    expect(findChrome()).toBeNull();
    resetChromeCache();
    expect(findChrome()).toBeNull();
    expect(getFirstInstallation).toHaveBeenCalledTimes(2);
  });
});
