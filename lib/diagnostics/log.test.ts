import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-log-"));
  process.env.MHM_LOG_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_LOG_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { logFile, logProblem, readRecentLog } from "./log";

beforeEach(async () => {
  await rm(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true }); // 로그 디렉터리 자동 생성은 첫 테스트에서 따로 검증한다
});

describe("문제 로그", () => {
  it("디렉터리가 없어도 만들어 기록한다", async () => {
    await rm(dir, { recursive: true, force: true });
    logProblem({ source: "route GET /x", message: "터졌다", detail: "Error: 터졌다\n  at foo" });
    const written = readFileSync(logFile(), "utf8");
    expect(written).toContain("[route GET /x] 터졌다");
    expect(written).toContain("at foo");
    // 타임스탬프가 앞에 붙어야 언제 난 문제인지 알 수 있다.
    expect(written).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("1MB를 넘으면 .1로 밀어내고 새 파일에 이어 쓴다", () => {
    logProblem({ source: "seed", message: "첫 줄" });
    // 롤링 조건을 실제 크기로 만든다.
    writeFileSync(logFile(), "x".repeat(1_000_001), "utf8");
    logProblem({ source: "after-roll", message: "두 번째" });

    expect(existsSync(`${logFile()}.1`)).toBe(true);
    const current = readFileSync(logFile(), "utf8");
    expect(current).toContain("두 번째");
    // 밀어낸 뒤 새 파일이 이전 내용을 물고 있으면 롤링이 무의미하다.
    expect(current.length).toBeLessThan(1000);
  });

  it("진단 번들에는 이전 세대 + 현재 세대를 순서대로 싣는다", () => {
    writeFileSync(`${logFile()}.1`, "예전 기록\n", "utf8");
    logProblem({ source: "now", message: "최근 기록" });
    const recent = readRecentLog();
    expect(recent.indexOf("예전 기록")).toBeLessThan(recent.indexOf("최근 기록"));
  });

  it("최근 로그는 요청한 크기를 넘지 않는다 (번들이 비대해지지 않게)", () => {
    writeFileSync(logFile(), "y".repeat(50_000), "utf8");
    expect(readRecentLog(1000).length).toBe(1000);
    // 잘라도 최신 쪽이 남아야 한다.
    writeFileSync(logFile(), `${"z".repeat(50_000)}마지막줄`, "utf8");
    expect(readRecentLog(1000)).toContain("마지막줄");
  });

  it("로그를 못 남겨도 예외를 던지지 않는다", () => {
    // 로깅 실패가 앱을 죽이면 안 된다 — 쓸 수 없는 경로를 준다.
    process.env.MHM_LOG_DIR = "/dev/null/불가능";
    expect(() => logProblem({ source: "x", message: "y" })).not.toThrow();
    expect(readRecentLog()).toBe("");
    process.env.MHM_LOG_DIR = dir;
  });
});
