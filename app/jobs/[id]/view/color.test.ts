import { describe, expect, it } from "vitest";
import { rgbToHex } from "./color";

describe("rgbToHex", () => {
  it("rgb를 hex로 바꾼다", () => {
    expect(rgbToHex("rgb(1, 2, 3)")).toBe("#010203");
    expect(rgbToHex("rgb(255, 255, 255)")).toBe("#ffffff");
  });

  it("알파가 있어도 0이 아니면 색으로 취급한다", () => {
    expect(rgbToHex("rgba(17, 17, 17, 0.5)")).toBe("#111111");
    expect(rgbToHex("rgba(17, 17, 17, 1)")).toBe("#111111");
  });

  it("투명은 null — 검정으로 위장하면 스와치 조작만으로 투명 셀이 검정으로 저장된다", () => {
    expect(rgbToHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(rgbToHex("transparent")).toBeNull();
  });

  it("해석 불가 값은 null", () => {
    expect(rgbToHex("")).toBeNull();
    expect(rgbToHex("currentcolor")).toBeNull();
  });
});
