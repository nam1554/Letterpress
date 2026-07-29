import { afterEach, describe, expect, it } from "vitest";
import { findChrome, resetChromeCache } from "./chrome";

const original = process.env.CHROME_BIN;

afterEach(() => {
  if (original === undefined) delete process.env.CHROME_BIN;
  else process.env.CHROME_BIN = original;
  resetChromeCache();
});

describe("findChrome", () => {
  it("실재하지 않는 CHROME_BIN은 믿지 않는다", () => {
    // 옛 경로가 환경에 남아 있으면 환경 점검은 초록불인데 검증만 조용히
    // 실패한다 — 15분 빌드를 태우고 나서야 알게 되는 최악의 조합.
    process.env.CHROME_BIN = "/nonexistent/Google Chrome";
    resetChromeCache();
    expect(findChrome()).not.toBe("/nonexistent/Google Chrome");
  });

  it("실재하는 CHROME_BIN은 그대로 쓴다", () => {
    process.env.CHROME_BIN = process.execPath; // 존재하는 실행 파일이면 무엇이든
    resetChromeCache();
    expect(findChrome()).toBe(process.execPath);
  });

  it("한 번 찾은 뒤에는 다시 탐색하지 않는다 (이벤트 루프 블로킹 방지)", () => {
    resetChromeCache();
    const first = findChrome();
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) findChrome();
    // 캐시가 없으면 lsregister 덤프로 회당 수 초가 걸린다.
    expect(performance.now() - t0).toBeLessThan(50);
    expect(findChrome()).toBe(first);
  });
});
