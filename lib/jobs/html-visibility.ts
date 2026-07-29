import { type Cheerio, type CheerioAPI, load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * 산출물 HTML에서 "실제로 보이는 것"을 재는 모듈 — 품질 게이트의 반-우회 검사가
 * 여기에 기댄다.
 *
 * 손으로 짠 정규식으로 CSS·HTML을 흉내 내던 구현은 코드 리뷰 세 라운드에서
 * 매번 새 발산을 만들었다(닫히지 않은 태그, 자손 선택자, 규칙 순서, 클래스
 * 폭 캐스케이드…). 그래서 파싱과 선택자 매칭은 파서(cheerio/parse5 + css-select)에
 * 맡기고, 이 파일은 "무엇을 숨김으로 볼 것인가"라는 판단만 담는다.
 *
 * 기준 렌더는 폭 700px 데스크톱 크롬 — compare.py가 픽셀 검증에 쓰는 바로 그
 * 화면이다. 그 화면에서 사라지지 않는 것은 숨김으로 치지 않는다.
 */

/** 이메일 본문 폭 = 검증 렌더 폭. %로 준 크기의 기준이기도 하다. */
export const DESKTOP_WIDTH = 700;

/**
 * 숨김 판정의 두 축 — 이미지 검사는 "화면에서 렌더되지 않는가"(layout)만 보고,
 * 텍스트 검사는 "글자가 안 보이는가"(text)까지 본다. 나누지 않으면
 * `<td style="font-size:0;line-height:0"><img …></td>`(이미지 간격 제거용 관용구,
 * 레퍼런스 발송본에 실재)의 이미지가 검사에서 사라져 슬라이스 검사가 뚫린다.
 */
export type HideKind = "text" | "layout";

/** 가시성에 영향을 주는 속성. 속성별로 마지막 선언이 이긴다. */
type HideProp =
  | "display"
  | "visibility"
  | "opacity"
  | "clip"
  | "mso-hide"
  | "offscreen"
  | "box"
  | "font-size"
  | "color"
  | "text-indent";

/** 상속되는 속성 — 자손이 다시 지정하면 그 자손의 글자는 보인다. */
const INHERITED_HIDE = new Set<HideProp>(["font-size", "color", "text-indent"]);

/** 요소에 적용된 선언들 중 이 모듈이 쓰는 것만 뽑은 상태. */
interface Style {
  hide: Map<HideProp, boolean>;
  width?: string;
  maxWidth?: string;
  height?: string;
}

function emptyStyle(): Style {
  return { hide: new Map() };
}

function mergeStyle(base: Style, next: Style): void {
  for (const [prop, hidden] of next.hide) base.hide.set(prop, hidden);
  if (next.width !== undefined) base.width = next.width;
  if (next.maxWidth !== undefined) base.maxWidth = next.maxWidth;
  if (next.height !== undefined) base.height = next.height;
}

/** 선언 블록 → (속성, 값). 속성명 형식 검사가 data URI의 `;`를 걸러낸다. */
function declarations(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    if (!/^[-a-z]+$/.test(prop)) continue;
    out.push([prop, decl.slice(i + 1).trim().toLowerCase()]);
  }
  return out;
}

/** 값의 선두 숫자 (없으면 NaN). */
function num(value: string): number {
  return Number.parseFloat(value);
}

/**
 * 선언 블록의 가시성 상태. 속성명을 정확히 비교한다 —
 * `background-color:transparent`나 `margin-left:-100px`는 숨김이 아니다.
 *
 * 크롬에서 실제로 사라지는 것만 숨김으로 친다: `clip`은 배치된 요소에만 먹고,
 * 0·1px 상자는 `overflow:hidden`이 함께 있을 때만 잘리며(td는 늘어난다),
 * `mso-hide:all`은 Outlook 전용이라 이미지 검사에는 적용하지 않는다.
 */
function parseStyle(css: string, kind: HideKind): Style {
  const style = emptyStyle();
  const decls = declarations(css);
  const last = (prop: string) => decls.findLast(([p]) => p === prop)?.[1];
  const positioned = /^(absolute|fixed)/.test(last("position") ?? "");
  const text = kind === "text";

  for (const [prop, value] of decls) {
    switch (prop) {
      case "display":
        style.hide.set("display", value.startsWith("none"));
        break;
      case "visibility":
        style.hide.set("visibility", /^(hidden|collapse)/.test(value));
        break;
      case "opacity":
        if (Number.isFinite(num(value))) style.hide.set("opacity", num(value) === 0);
        break;
      case "clip":
        style.hide.set("clip", positioned && /rect\(\s*0/.test(value));
        break;
      case "mso-hide":
        if (text) style.hide.set("mso-hide", value.startsWith("all"));
        break;
      case "left":
      case "top":
        // 화면 밖으로 밀어내는 관용구 — position이 걸려 있을 때만 실제로 숨는다.
        if (positioned && num(value) <= -100) style.hide.set("offscreen", true);
        break;
      case "font-size":
        if (text && Number.isFinite(num(value))) style.hide.set("font-size", num(value) === 0);
        break;
      case "color":
        if (text) {
          style.hide.set("color", /^(transparent|rgba\([^)]*,\s*0(\.0+)?\s*\))/.test(value));
        }
        break;
      case "text-indent":
        if (text && Number.isFinite(num(value))) style.hide.set("text-indent", num(value) <= -100);
        break;
      case "width":
        style.width = value;
        break;
      case "max-width":
        style.maxWidth = value;
        break;
      case "height":
        style.height = value;
        break;
    }
  }
  // 0·1px로 잘려 안 보이는 상자 — 어느 한 축만 잠겨도 내용은 보이지 않는다.
  const px = (raw?: string) => (raw !== undefined && !raw.includes("%") ? num(raw) : Number.NaN);
  if (/^hidden/.test(last("overflow") ?? "") && (px(style.width) <= 1 || px(style.height) <= 1)) {
    style.hide.set("box", true);
  }
  return style;
}

interface CssRule {
  selector: string;
  body: string;
}

/**
 * `@media` 질의가 데스크톱 렌더에 적용되는지. 폭 조건은 700px 기준으로 따지고,
 * 다크 모드는 적용하지 않는다(검증 렌더는 라이트 모드다). 그 밖의 기능 질의
 * (`-webkit-min-device-pixel-ratio` 같은 관용 해킹)는 데스크톱 크롬에서 그대로
 * 적용되므로 막지 않는다.
 */
function mediaApplies(prelude: string): boolean {
  const query = prelude.replace(/^@media/i, "").trim().toLowerCase();
  if (!query) return true;
  return query.split(",").some((one) => {
    if (/\bprint\b/.test(one) && !/\b(screen|all)\b/.test(one)) return false;
    for (const cond of one.matchAll(/\(([^)]*)\)/g)) {
      const [rawName, rawValue] = cond[1].split(":").map((s) => s.trim());
      const name = (rawName ?? "").replace(/^(min|max)-device-/, "$1-");
      if (name === "prefers-color-scheme") return rawValue !== "dark";
      if (name !== "max-width" && name !== "min-width") continue;
      const px = num(rawValue ?? "") * (/r?em\s*$/.test(rawValue ?? "") ? 16 : 1);
      if (!Number.isFinite(px)) continue;
      if (name === "max-width" ? DESKTOP_WIDTH > px : DESKTOP_WIDTH < px) return false;
    }
    return true;
  });
}

/**
 * `<style>` 내용을 (선택자, 선언블록) 목록으로 편다. 중괄호 짝을 세므로
 * `@media`·`@supports` 안의 규칙도 제자리에서 꺼낸다 — 감싸기만 해서 숨김
 * 규칙을 감추지 못하게.
 */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
      }
      const body = text.slice(open + 1, depth === 0 ? j - 1 : text.length);
      if (selector.startsWith("@")) {
        if (!/^@media/i.test(selector) || mediaApplies(selector)) walk(body);
      } else if (selector) {
        out.push({ selector, body });
      }
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return out;
}

/**
 * 문서의 모든 요소에 적용된 스타일 표. 규칙은 문서 순서대로 적용하고(뒤 규칙이
 * 이긴다) 인라인 스타일을 마지막에 얹는다 — 선택자 매칭은 css-select가 하므로
 * 자손·태그·속성 선택자가 정확히 걸린다.
 */
function styleIndex($: CheerioAPI, kind: HideKind): Map<Element, Style> {
  const index = new Map<Element, Style>();
  const at = (el: Element) => {
    let style = index.get(el);
    if (!style) index.set(el, (style = emptyStyle()));
    return style;
  };

  $("style").each((_, el) => {
    for (const rule of cssRules($(el).text())) {
      const parsed = parseStyle(rule.body, kind);
      if (parsed.hide.size === 0 && !parsed.width && !parsed.maxWidth && !parsed.height) continue;
      let matched: Cheerio<AnyNode>;
      try {
        // `:hover` 같은 상태 선택자는 기본 상태가 아니므로 건너뛴다.
        if (/:{1,2}[-\w]/.test(rule.selector)) continue;
        matched = $(rule.selector);
      } catch {
        continue; // css-select가 모르는 선택자는 무시
      }
      matched.each((__, node) => mergeStyle(at(node as Element), parsed));
    }
  });

  $("[style]").each((_, el) => {
    mergeStyle(at(el), parseStyle($(el).attr("style") ?? "", kind));
  });
  return index;
}

/** 지금 요소에서 숨겨진 속성들 (상속 포함). */
function hiddenAt(style: Style | undefined, inherited: Set<HideProp>): Set<HideProp> {
  const active = new Set(inherited);
  if (style) {
    for (const [prop, hidden] of style.hide) {
      if (hidden) active.add(prop);
      else active.delete(prop); // 자손이 다시 지정하면 그 자손은 보인다
    }
  }
  return active;
}

/** 렌더되는 `<img>` — 표시 크기 계산에 필요한 것만 담는다. */
export interface RenderedImage {
  src: string;
  /** 마크업이 지정한 표시 폭 (px). 없으면 undefined. */
  width?: number;
  /** `max-width` 상한 (px). 폭을 만들지는 않고 상한으로만 쓴다. */
  maxWidth?: number;
  /** 마크업이 지정한 표시 높이 (px). 없으면 undefined. */
  height?: number;
}

export interface Rendered {
  /** 보이는 텍스트의 비공백 글자 수. */
  textChars: number;
  /** 화면에 실제로 렌더되는 이미지들. */
  images: RenderedImage[];
}

/** 속성 또는 스타일 값에서 px 표시 길이 — `%`는 본문 폭 기준으로 환산한다. */
function lengthPx(raw: string | undefined, axis: "w" | "h"): number | undefined {
  if (raw === undefined) return undefined;
  const m = raw.trim().match(/^([\d.]+)\s*(px|%)?$/);
  if (!m) return undefined;
  const value = num(m[1]);
  if (!Number.isFinite(value)) return undefined;
  if (m[2] === "%") {
    // 세로 %는 이메일에서 기준이 없어 의미가 없다.
    return axis === "w" ? (DESKTOP_WIDTH * value) / 100 : undefined;
  }
  // 0·1px은 표시 크기로 믿지 않는다 — `height="0"` 한 줄로 검사를 끌 수 있다.
  return value > 1 ? value : undefined;
}

function imageBox($: CheerioAPI, el: Element, style: Style | undefined): RenderedImage {
  const attr = (name: string) => $(el).attr(name);
  const width = lengthPx(style?.width ?? attr("width"), "w");
  const maxWidth = lengthPx(style?.maxWidth, "w");
  const height = lengthPx(style?.height ?? attr("height"), "h");
  // `max-width`만으로는 폭이 정해지지 않는다 — `max-width:100%`는 거의 모든
  // 반응형 이미지에 붙어 있어서, 그걸 폭으로 읽으면 전부 전폭 아트가 된다.
  return { src: attr("src") ?? "", width, maxWidth, height };
}

/**
 * 데스크톱 렌더에서 실제로 보이는 텍스트 양과 이미지 목록.
 * `kind`가 "text"면 글자를 안 보이게 하는 선언(font-size:0 등)까지 숨김으로 친다.
 */
// 게이트는 같은 문서를 텍스트·이미지 검사에서 여러 번 본다 — 파싱은 한 번이면
// 된다. 캐시는 몇 개만 들고 있다가 버린다(잡마다 HTML 2종).
const CACHE_LIMIT = 4;
const cache = new Map<string, Rendered>();

export function renderHtml(html: string, kind: HideKind): Rendered {
  const key = `${kind} ${html}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = analyze(html, kind);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

function analyze(html: string, kind: HideKind): Rendered {
  const $ = load(html);
  const styles = styleIndex($, kind);
  const images: RenderedImage[] = [];
  const SKIP = new Set(["style", "script", "head", "title", "template", "noscript"]);
  let textChars = 0;

  const walk = (node: AnyNode, inherited: Set<HideProp>): void => {
    if (node.type === "text") {
      if (inherited.size === 0) textChars += node.data.replace(/\s+/g, "").length;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    const style = styles.get(el);
    const active = hiddenAt(style, inherited);
    // 상속되지 않는 숨김(display:none 등)은 하위 전체가 렌더되지 않는다.
    if ([...active].some((prop) => !INHERITED_HIDE.has(prop))) return;
    if (tag === "img") {
      images.push(imageBox($, el, style));
      return;
    }
    for (const child of el.children) walk(child, active);
  };

  for (const node of $.root().toArray()[0]?.children ?? []) walk(node, new Set());
  return { textChars, images };
}
