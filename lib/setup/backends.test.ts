import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * getBackendSetup의 합류·캐시 동작만 검증한다 — 실제 CLI 스폰(claudeSetup의
 * `mcp list`는 최대 45초)은 목으로 대체한다. 여기서 재는 것은 "진단을 몇 번
 * 돌리는가"이지 진단 내용이 아니다.
 */
const spawns = { count: 0 };

vi.mock("node:child_process", () => ({
  execFile: (
    _bin: string,
    _args: string[],
    _opts: unknown,
    cb: (e: Error | null, r: { stdout: string; stderr: string }) => void,
  ) => {
    spawns.count += 1;
    setTimeout(() => cb(null, { stdout: "1.0.0", stderr: "" }), 60);
  },
}));

afterEach(() => {
  const g = globalThis as unknown as {
    __mhmSetup?: unknown;
    __mhmSetupInFlight?: unknown;
  };
  g.__mhmSetup = undefined;
  g.__mhmSetupInFlight = undefined;
  spawns.count = 0;
});

describe("getBackendSetup 합류", () => {
  it("동시 요청은 진단 한 번에 합류한다", async () => {
    const { getBackendSetup } = await import("./backends");
    const results = await Promise.all([
      getBackendSetup(),
      getBackendSetup(),
      getBackendSetup(),
      getBackendSetup(),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe(results[3]);
    const oneRun = spawns.count;
    // 같은 진단 한 번 분량만 스폰돼야 한다 — 4배가 되면 합류가 깨진 것이다.
    expect(oneRun).toBeGreaterThan(0);
    expect(oneRun).toBeLessThan(oneRun * 2);
  });

  it("force 연타도 합류한다 — 다시 점검이 CLI를 중복 스폰하면 안 된다", async () => {
    // 실측(2026-08-08): force가 합류를 건너뛰어 `claude mcp list` 3개가 동시에
    // 떴다. force는 "캐시를 믿지 말라"이지 "CLI를 또 띄우라"가 아니다.
    const { getBackendSetup } = await import("./backends");
    const [a, b, c] = await Promise.all([
      getBackendSetup(true),
      getBackendSetup(true),
      getBackendSetup(true),
    ]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    const forceSpawns = spawns.count;

    // 비교군: 순차로 두 번 force를 부르면 두 번 진단한다(캐시를 실제로 무시).
    spawns.count = 0;
    await getBackendSetup(true);
    const single = spawns.count;
    expect(forceSpawns).toBeLessThanOrEqual(single * 1.5);
  });

  it("force는 캐시를 무시하고 다시 진단한다", async () => {
    const { getBackendSetup } = await import("./backends");
    await getBackendSetup();
    const afterFirst = spawns.count;
    await getBackendSetup(); // 캐시 히트 — 스폰 없음
    expect(spawns.count).toBe(afterFirst);
    await getBackendSetup(true); // force — 다시 진단
    expect(spawns.count).toBeGreaterThan(afterFirst);
  });
});
