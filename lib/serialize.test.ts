import { describe, expect, it } from "vitest";
import { withKeyedLock } from "./serialize";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withKeyedLock", () => {
  it("같은 키의 작업을 도착 순서대로 실행한다", async () => {
    const locks = new Map<string, Promise<unknown>>();
    const order: number[] = [];
    await Promise.all([
      withKeyedLock(locks, "k", async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
      }),
      withKeyedLock(locks, "k", async () => {
        order.push(2);
      }),
      withKeyedLock(locks, "k", async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("다른 키는 서로 기다리지 않는다", async () => {
    const locks = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    await Promise.all([
      withKeyedLock(locks, "slow", async () => {
        await new Promise((r) => setTimeout(r, 40));
        order.push("slow");
      }),
      withKeyedLock(locks, "fast", async () => {
        order.push("fast");
      }),
    ]);
    expect(order).toEqual(["fast", "slow"]);
  });

  it("실패가 호출자에게 전파되지만 다음 대기자를 막지 않는다", async () => {
    const locks = new Map<string, Promise<unknown>>();
    const first = withKeyedLock(locks, "k", async () => {
      throw new Error("boom");
    });
    const second = withKeyedLock(locks, "k", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });

  it("마지막 대기자가 끝나면 엔트리를 비운다", async () => {
    const locks = new Map<string, Promise<unknown>>();
    await withKeyedLock(locks, "k", async () => {});
    await tick(); // finally 정리는 비동기다
    expect(locks.size).toBe(0);
  });

  it("끝난 작업의 정리가 새 대기자의 엔트리를 지우지 않는다", async () => {
    const locks = new Map<string, Promise<unknown>>();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = withKeyedLock(locks, "k", async () => {});
    // first가 끝난 직후, 정리(finally)가 마이크로태스크로 돌기 전에 새 대기자 등록.
    const second = withKeyedLock(locks, "k", () => gate);
    await first;
    await tick();
    // 무조건 삭제였다면 여기서 엔트리가 사라져 세 번째 작업이 second를
    // 기다리지 않게 된다(직렬화 붕괴).
    expect(locks.size).toBe(1);
    release();
    await second;
    await tick();
    expect(locks.size).toBe(0);
  });
});
