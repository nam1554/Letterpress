// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EDIT_STYLE_ID, SELECTED_ATTR, serializeEditedDocument } from "./serialize";

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("serializeEditedDocument", () => {
  it("편집 흔적(contenteditable, 주입 스타일, 선택 속성)을 모두 제거한다", () => {
    const doc = docFrom(
      `<!doctype html><html><head><style id="${EDIT_STYLE_ID}">[x]{}</style></head>` +
        `<body contenteditable="true"><td ${SELECTED_ATTR}="">본문</td></body></html>`,
    );
    const out = serializeEditedDocument(doc);
    expect(out).not.toContain("contenteditable");
    expect(out).not.toContain(EDIT_STYLE_ID);
    expect(out).not.toContain(SELECTED_ATTR);
    expect(out).toContain("본문");
  });

  it("doctype을 보존한다", () => {
    const out = serializeEditedDocument(docFrom("<!doctype html><html><body>x</body></html>"));
    expect(out.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("Outlook 조건부 주석을 보존한다", () => {
    const doc = docFrom(
      "<!doctype html><html><body><!--[if mso]><table><tr><td>mso</td></tr></table><![endif]-->본문</body></html>",
    );
    const out = serializeEditedDocument(doc);
    expect(out).toContain("<!--[if mso]>");
    expect(out).toContain("<![endif]-->");
  });

  it("원본 문서의 DOM을 변경하지 않는다 (클론에서 정리)", () => {
    const doc = docFrom(
      `<!doctype html><html><body contenteditable="true"><p ${SELECTED_ATTR}="">x</p></body></html>`,
    );
    serializeEditedDocument(doc);
    expect(doc.body.getAttribute("contenteditable")).toBe("true");
    expect(doc.querySelector(`[${SELECTED_ATTR}]`)).not.toBeNull();
  });

  it("인라인 스타일 수정 결과는 그대로 남는다", () => {
    const doc = docFrom('<!doctype html><html><body><p style="color: rgb(200, 100, 50);">x</p></body></html>');
    expect(serializeEditedDocument(doc)).toContain("color: rgb(200, 100, 50)");
  });
});
