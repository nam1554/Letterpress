import { describe, expect, it } from "vitest";
import { hmrGlobal } from "./hmr-global";

describe("hmrGlobal", () => {
  it("같은 키는 리로드(재호출)에도 같은 인스턴스를 돌려준다", () => {
    const a = hmrGlobal("__hmrTestA", () => new Map<string, number>());
    a.set("x", 1);
    // 모듈 리로드를 흉내낸 두 번째 호출 — init이 다시 불리면 상태가 유실된다.
    const again = hmrGlobal("__hmrTestA", () => new Map<string, number>());
    expect(again).toBe(a);
    expect(again.get("x")).toBe(1);
  });

  it("다른 키는 독립된 인스턴스다", () => {
    const a = hmrGlobal("__hmrTestB", () => new Map());
    const b = hmrGlobal("__hmrTestC", () => new Map());
    expect(a).not.toBe(b);
  });
});
