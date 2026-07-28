import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "./figma";

describe("parseFigmaUrl", () => {
  it("parses a design URL with node-id", () => {
    const ref = parseFigmaUrl(
      "https://www.figma.com/design/EXAMPLEfileKey12345678/AISURFER_%EC%83%81%ED%92%88?node-id=2343-115&m=dev",
    );
    expect(ref?.fileKey).toBe("EXAMPLEfileKey12345678");
    expect(ref?.nodeId).toBe("2343:115");
  });

  it("parses legacy /file/ URLs without node-id", () => {
    const ref = parseFigmaUrl("https://figma.com/file/abcDEF123/My-File");
    expect(ref?.fileKey).toBe("abcDEF123");
    expect(ref?.nodeId).toBeUndefined();
  });

  it("rejects non-figma URLs and garbage", () => {
    expect(parseFigmaUrl("https://example.com/design/abc")).toBeNull();
    expect(parseFigmaUrl("https://notfigma.com?u=figma.com")).toBeNull();
    expect(parseFigmaUrl("hello world")).toBeNull();
    expect(parseFigmaUrl("https://www.figma.com/")).toBeNull();
  });
});
