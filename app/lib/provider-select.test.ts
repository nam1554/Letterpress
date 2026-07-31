import { describe, expect, it } from "vitest";
import { providerOptionLabel } from "./provider-select";

// 오늘은 네 프로바이더가 전부 verified/sample이고 백엔드도 대부분 ready라,
// "미검증"·"설정 필요" 마크가 실제 화면 어디에서도 렌더되지 않는다 (리뷰
// Important 3). 합성 데이터로 두 마크를 각각·동시에 검증한다.
describe("providerOptionLabel", () => {
  const verified = { id: "claude-code", label: "Claude Code (local CLI)", verification: "verified" as const };
  const unverified = { id: "new-backend", label: "New Backend", verification: "unverified" as const };
  const ready = { id: "claude-code", ready: true };
  const notReady = { id: "claude-code", ready: false };

  it("마크가 없으면 라벨 그대로", () => {
    expect(providerOptionLabel(verified, ready)).toBe("Claude Code (local CLI)");
  });

  it("backend 정보가 없어도(undefined) 라벨 그대로", () => {
    expect(providerOptionLabel(verified, undefined)).toBe("Claude Code (local CLI)");
  });

  it("ready:false면 '설정 필요' 마크만 붙는다", () => {
    expect(providerOptionLabel(verified, notReady)).toBe("Claude Code (local CLI) · 설정 필요");
  });

  it("verification:unverified면 '미검증' 마크만 붙는다", () => {
    expect(providerOptionLabel(unverified, ready)).toBe("New Backend · 미검증");
  });

  it("두 조건이 겹치면 두 마크가 모두, 이 순서로 붙는다", () => {
    expect(providerOptionLabel(unverified, notReady)).toBe("New Backend · 설정 필요 · 미검증");
  });

  it("sample 프로바이더는 unverified가 아니므로 미검증 마크가 붙지 않는다", () => {
    const sample = { id: "mock", label: "Mock", verification: "sample" as const };
    expect(providerOptionLabel(sample, ready)).toBe("Mock");
  });
});
