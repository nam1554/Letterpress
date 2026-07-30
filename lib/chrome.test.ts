import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("캐시된 경로가 사라지면 다시 탐색한다", async () => {
    // 서버는 몇 시간씩 떠 있다. 찾은 경로를 무기한 믿으면 그 사이 Chrome이
    // 지워졌을 때 죽은 경로를 계속 돌려주고, 게이트는 launch 실패를 "판정 불가"
    // 경고로 격하해 반-우회 검사 3개를 조용히 끈다.
    const stale = path.join(await mkdtemp(path.join(tmpdir(), "chrome-")), "Google Chrome");
    await writeFile(stale, "#!/bin/sh\n", { mode: 0o755 });
    process.env.CHROME_BIN = stale;
    resetChromeCache();
    expect(findChrome()).toBe(stale);

    await rm(stale);
    expect(findChrome()).not.toBe(stale);
  });

  it("CHROME_BIN이 바뀌면 캐시를 무시한다", () => {
    process.env.CHROME_BIN = process.execPath;
    resetChromeCache();
    expect(findChrome()).toBe(process.execPath);
    process.env.CHROME_BIN = "/nonexistent/Google Chrome";
    expect(findChrome()).not.toBe(process.execPath);
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
