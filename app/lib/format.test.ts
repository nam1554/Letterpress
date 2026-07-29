import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats byte counts for job rows", () => {
    expect(formatBytes(0)).toBe("1KB 미만");
    expect(formatBytes(999)).toBe("1KB 미만");
    expect(formatBytes(1536)).toBe("1.5KB");
    expect(formatBytes(12_582_912)).toBe("12.0MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0GB");
  });
});
