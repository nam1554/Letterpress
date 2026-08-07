/** 편집 모드가 iframe 문서에 주입하는 스타일 요소의 id. */
export const EDIT_STYLE_ID = "__mhm-edit-style";
/** 선택된 요소 표시(아웃라인용) 속성. */
export const SELECTED_ATTR = "data-mhm-selected";

/**
 * 편집 중인 iframe 문서를 저장용 HTML 문자열로 직렬화한다.
 * 편집 흔적(contenteditable, 주입 스타일, 선택 표시)은 클론에서 제거한다 —
 * 라이브 DOM을 건드리면 저장 실패 후 편집을 이어갈 수 없다.
 */
export function serializeEditedDocument(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelector(`#${EDIT_STYLE_ID}`)?.remove();
  for (const el of root.querySelectorAll(`[${SELECTED_ATTR}]`)) el.removeAttribute(SELECTED_ATTR);
  root.querySelector("body")?.removeAttribute("contenteditable");

  // figma-edm 산출물은 항상 <!doctype html> — PUBLIC/SYSTEM 재구성은 이 앱이
  // 편집하는 어떤 문서에도 해당 없는 미검증 일반화라서 두지 않는다.
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  return `${doctype}\n${root.outerHTML}`;
}
