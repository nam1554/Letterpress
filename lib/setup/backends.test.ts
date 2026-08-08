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
  /**
   * 진단 한 번이 띄우는 CLI 호출 수 — 비교 기준선.
   * 측정 뒤 캐시를 비운다. 안 그러면 이어지는 호출이 캐시 히트가 돼 스폰이
   * 0이 되고, 합류 검증이 캐시 검증으로 바뀐다.
   */
  async function baselineSpawns(): Promise<number> {
    const { getBackendSetup } = await import("./backends");
    spawns.count = 0;
    await getBackendSetup(true);
    const n = spawns.count;
    (globalThis as unknown as { __mhmSetup?: unknown }).__mhmSetup = undefined;
    spawns.count = 0;
    return n;
  }

  it("동시 요청은 진단 한 번에 합류한다", async () => {
    const { getBackendSetup } = await import("./backends");
    const base = await baselineSpawns();
    const results = await Promise.all([
      getBackendSetup(),
      getBackendSetup(),
      getBackendSetup(),
      getBackendSetup(),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe(results[3]);
    // 기준선과 비교한다 — 합류가 깨지면 4배가 된다.
    expect(spawns.count).toBe(base);
  });

  it("force 연타는 합류한다 — 다시 점검이 CLI를 중복 스폰하면 안 된다", async () => {
    // 실측(2026-08-08): force가 합류를 건너뛰어 `claude mcp list` 3개가 동시에
    // 떴다. force 연타는 같은 것을 원하므로 한 번만 돌면 된다.
    const { getBackendSetup } = await import("./backends");
    const base = await baselineSpawns();
    const [a, b, c] = await Promise.all([
      getBackendSetup(true),
      getBackendSetup(true),
      getBackendSetup(true),
    ]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(spawns.count).toBe(base);
  });

  it("force는 진행 중인 일반 점검에 합류하지 않는다 — 방금 고친 것이 반영돼야 한다", async () => {
    // 리뷰 실측: 합류시켰더니 토큰 저장 직후의 갱신이 **저장 이전** 상태를
    // 돌려줬다. 그 점검은 force 요청보다 먼저 시작됐으므로 신선하지 않다.
    const { getBackendSetup } = await import("./backends");
    const base = await baselineSpawns();
    const slow = getBackendSetup(); // 일반 점검 시작
    await new Promise((r) => setTimeout(r, 10)); // 진행 중인 상태를 만든다
    const forced = getBackendSetup(true); // 그 사이 사용자가 설정을 고치고 갱신
    const [normal, fresh] = await Promise.all([slow, forced]);
    expect(fresh).not.toBe(normal); // 별도 측정이어야 한다
    expect(spawns.count).toBe(base * 2); // 진단이 두 번 돌았다
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
