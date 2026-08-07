/**
 * "rgb(1, 2, 3)" → "#010203" — <input type="color">는 hex만 받는다.
 * 투명(알파 0)과 해석 불가 값은 null: 이메일 테이블의 배경은 대부분
 * `rgba(0, 0, 0, 0)`(투명)인데, 이를 검정으로 보여주면 사용자가 스와치를
 * 건드리기만 해도 투명 셀이 검정 배경으로 저장된다.
 */
export function rgbToHex(color: string): string | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return `#${m
    .slice(1, 4)
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
}
