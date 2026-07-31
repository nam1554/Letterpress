import { describe, expect, it } from "vitest";
import { listProviders } from "./registry";

describe("프로바이더 검증 상태", () => {
  it("모든 프로바이더가 검증 상태와 근거를 노출한다", () => {
    const all = listProviders();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.verification).toMatch(/^(verified|unverified|sample)$/);
      expect(p.verificationNote.trim().length).toBeGreaterThan(0);
    }
  });

  // "verified"는 측정 기록이 있을 때만 붙인다 — 근거에 측정 날짜를 요구해
  // 규칙을 코드로 강제한다.
  it("verified 프로바이더의 근거에는 측정 날짜가 들어간다", () => {
    for (const p of listProviders()) {
      if (p.verification !== "verified") continue;
      expect(p.verificationNote).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
