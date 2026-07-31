import { describe, expect, it } from "vitest";
import { runExclusive } from "./measure";

/**
 * 브라우저를 띄우는 구간의 직렬화 장치.
 *
 * 왜 여기서만 테스트하나: 진짜 Chrome을 여러 개 띄워 겹침을 재려면 테스트
 * 자체가 지금 고치려는 그 자원 경쟁을 일으킨다. 장치를 순수 함수로 빼서
 * 겹침 여부만 직접 관찰한다.
 */
describe("runExclusive", () => {
  it("동시에 부르면 겹치지 않는다", async () => {
    let active = 0;
    let maxActive = 0;
    const body = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    };

    await Promise.all(Array.from({ length: 5 }, () => runExclusive(body)));

    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it("들어온 순서대로 실행한다", async () => {
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2].map((i) =>
        runExclusive(async () => {
          // 첫 작업을 가장 오래 붙잡아 둔다 — 순서가 안 지켜지면 뒤집힌다.
          await new Promise((r) => setTimeout(r, 10 - i * 4));
          order.push(i);
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2]);
  });

  it("앞 작업이 실패해도 뒤 작업이 막히지 않는다", async () => {
    // 큐를 reject 상태로 남기면 이후 모든 측정이 앞 작업의 오류를 물려받는다.
    const failed = runExclusive(async () => {
      throw new Error("launch failed");
    });
    await expect(failed).rejects.toThrow("launch failed");

    await expect(runExclusive(async () => "ok")).resolves.toBe("ok");
  });

  it("호출자에게 반환값을 그대로 돌려준다", async () => {
    await expect(runExclusive(async () => ({ n: 42 }))).resolves.toEqual({ n: 42 });
  });

  it("앞 작업이 끝나기 전에는 뒤 작업이 시작조차 하지 않는다", async () => {
    // 취소 확인을 슬롯 획득 '이후'에 한 번 더 하는 이유가 여기 있다 —
    // 대기 중에 잡이 취소될 수 있다.
    let secondStarted = false;
    let releaseFirst: () => void = () => {};
    const first = runExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = runExclusive(async () => {
      secondStarted = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(secondStarted).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });
});
