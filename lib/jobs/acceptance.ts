import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { type ImageSize, imageSize } from "./image-size";
import { outputDir, workDir } from "./store";

/**
 * 품질 게이트 — 잡 성공은 에이전트 자기 보고가 아니라 파일시스템의 산출물
 * 계약으로 판정한다: 최종 HTML 2종 + 픽셀 검증 증거물 + verify.json PASS.
 * verify.json은 figma-edm compare.py가 workDir 루트(EDM_DIR)에 남긴다.
 */

/** compare.py가 쓰는 기계 판독 판정 (관용 파싱 후 요약만 보관). */
export interface VerifySummary {
  result: "PASS" | "FAIL";
  overall?: number;
  heightDelta?: number;
}

export interface Acceptance {
  ok: boolean;
  /** 잡을 실패시키는 미충족 항목 — 보수 프롬프트에 그대로 실린다. */
  failures: string[];
  /** 성공은 유지하되 리포트할 항목. */
  warnings: string[];
  verify: VerifySummary | null;
}

/** workDir/verify.json 요약. 없거나 형식이 어긋나면 null. */
export async function readVerifySummary(jobId: string): Promise<VerifySummary | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(workDir(jobId), "verify.json"), "utf8"));
    if (raw?.result !== "PASS" && raw?.result !== "FAIL") return null;
    return {
      result: raw.result,
      overall: Number.isFinite(raw.overall) ? raw.overall : undefined,
      heightDelta: Number.isFinite(raw.height_delta) ? raw.height_delta : undefined,
    };
  } catch {
    return null;
  }
}

// 검증이 실제로 실행됐음을 증명하는 파일들 (compare.py 산출물 + 레퍼런스).
const VERIFY_EVIDENCE = ["figma_full.png", "my_full.png", "side_by_side.png"];

/**
 * 통짜 이미지 꼼수 방지 — 이메일 전체를 스크린샷 한 장으로 만들면 렌더가 곧
 * 원본이라 픽셀 검증은 자명하게 통과한다(실측: codex가 2.4분/99.97%로 이렇게
 * 통과). 그 산출물은 복사·검색·접근성·이미지 차단 대응이 전부 죽으므로,
 * 게이트가 본문 카피의 라이브 텍스트 최소량을 별도로 요구한다.
 * (실측: 정상 빌드 ~1,900자 · mock ~140자 · 통짜 이미지 20자)
 *
 * 반드시 "보이는" 텍스트여야 한다 — 2차 실측에서 codex가 스크린리더 전용
 * 숨김 div(1px/clip)에 카피를 넣어 글자 수만 채웠다. 보이는 텍스트는 픽셀
 * 검증과 맞물려 위조가 안 된다: 디자인에 없는 보이는 텍스트는 verify를
 * 깨뜨리고, 숨긴 텍스트는 여기서 세지 않는다.
 */
const MIN_LIVE_TEXT_CHARS = 100;

/**
 * 숨김 판정의 두 축 — 이미지 검사는 "화면에서 렌더되지 않는가"(layout)만 보고,
 * 텍스트 검사는 "글자가 안 보이는가"(text)까지 본다. 나누지 않으면
 * `<td style="font-size:0;line-height:0"><img …></td>`(이미지 간격 제거용 관용구,
 * 레퍼런스 발송본에 실재)의 이미지가 검사에서 사라져 슬라이스 검사가 뚫린다.
 */
type HideKind = "text" | "layout";

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

/** 값의 선두 숫자 (없으면 NaN). `0px`·`-9999px`·`0.5` 모두 처리. */
function num(value: string): number {
  return Number.parseFloat(value);
}

/**
 * 가시성에 영향을 주는 속성. 속성별로 마지막 선언이 이기고, 하나라도 숨김이면
 * 그 요소는 숨겨진 것으로 본다 — "아무 선언이나 보이면 해제"로 두면
 * `.copy{display:none}` 뒤의 `.copy{color:#333}` 하나가 숨김을 취소한다.
 */
type HideProp =
  | "display"
  | "visibility"
  | "opacity"
  | "clip"
  | "mso-hide"
  | "left"
  | "top"
  | "box"
  | "font-size"
  | "color"
  | "text-indent";

/** 상속되는 속성 — 자손이 다시 지정하면 그 자손의 글자는 보인다. */
const INHERITED_HIDE = new Set<HideProp>(["font-size", "color", "text-indent"]);

/**
 * 선언 블록의 가시성 상태 (속성 → 숨김 여부). 속성명을 정확히 비교한다 —
 * 예전 구현은 하나의 정규식으로 값만 훑어 `background-color:transparent`나
 * `margin-left:-100px` 같은 평범한 선언까지 숨김으로 읽고 본문을 통째로 지웠다.
 *
 * 브라우저에서 실제로 안 보이는 것만 숨김으로 친다: `clip`은 배치된 요소에만
 * 먹고, 1px 상자는 `overflow:hidden`이 함께 있을 때만 잘린다(td는 늘어난다).
 * `mso-hide:all`은 Outlook 전용이라 이미지 검사(layout)에는 적용하지 않는다 —
 * 크롬 렌더에는 그대로 보이므로 그걸로 이미지를 감출 수 있으면 안 된다.
 */
function visibilityState(css: string, kind: HideKind): Map<HideProp, boolean> {
  const state = new Map<HideProp, boolean>();
  const decls = declarations(css);
  const last = (prop: string) => decls.findLast(([p]) => p === prop)?.[1];
  const positioned = /^(absolute|fixed)/.test(last("position") ?? "");
  const text = kind === "text";

  for (const [prop, value] of decls) {
    switch (prop) {
      case "display":
        state.set("display", value.startsWith("none"));
        break;
      case "visibility":
        state.set("visibility", /^(hidden|collapse)/.test(value));
        break;
      case "opacity":
        if (Number.isFinite(num(value))) state.set("opacity", num(value) === 0);
        break;
      case "clip":
        state.set("clip", positioned && /rect\(\s*0/.test(value));
        break;
      case "mso-hide":
        if (text) state.set("mso-hide", value.startsWith("all"));
        break;
      // 화면 밖으로 밀어내는 관용구 — position이 걸려 있을 때만 실제로 숨겨진다.
      case "left":
      case "top":
        state.set(prop, positioned && num(value) <= -100);
        break;
      case "font-size":
        if (text && Number.isFinite(num(value))) state.set("font-size", num(value) === 0);
        break;
      case "color":
        if (text) state.set("color", /^(transparent|rgba\([^)]*,\s*0(\.0+)?\s*\))/.test(value));
        break;
      case "text-indent":
        if (text && Number.isFinite(num(value))) state.set("text-indent", num(value) <= -100);
        break;
    }
  }
  // 1px 클리핑(sr-only)은 가로·세로가 모두 잠기고 넘침이 잘릴 때만.
  const box = (prop: string) => {
    const v = last(prop);
    return v !== undefined && !v.includes("%") ? num(v) : NaN;
  };
  const clipped = /^hidden/.test(last("overflow") ?? "") || state.get("clip") === true;
  if (clipped && box("width") <= 1 && box("height") <= 1) state.set("box", true);
  return state;
}

/** 상태에서 실제로 숨기고 있는 속성들. */
function hidingProps(state: Map<HideProp, boolean>): HideProp[] {
  return [...state].filter(([, hidden]) => hidden).map(([prop]) => prop);
}

/** 데스크톱 렌더 기준 — 픽셀 검증이 비교하는 것이 이 폭의 렌더다. */
const DESKTOP_WIDTH = 700;

/**
 * `@media` 질의가 데스크톱 렌더에 적용되는지. 폭 조건만 판정한다 — 모바일 전용
 * 규칙(`max-width:600px`)의 `display:none`을 숨김으로 읽으면 정상 반응형
 * 산출물의 데스크톱 콘텐츠가 통째로 사라지고, 반대로 `(-webkit-min-device-
 * pixel-ratio:0)` 같은 관용 해킹을 "적용 안 함"으로 처리하면 그걸로 감싸기만
 * 해도 숨김 규칙을 놓친다(데스크톱 크롬에서는 그대로 적용되는 질의다).
 */
function mediaApplies(prelude: string): boolean {
  const query = prelude.replace(/^@media/i, "").trim().toLowerCase();
  if (!query) return true;
  return query.split(",").some((one) => {
    if (/\bprint\b/.test(one) && !/\b(screen|all)\b/.test(one)) return false;
    for (const cond of one.matchAll(/\(([^)]*)\)/g)) {
      const [rawName, rawValue] = cond[1].split(":").map((s) => s.trim());
      const name = (rawName ?? "").replace(/^(min|max)-device-/, "$1-");
      if (name !== "max-width" && name !== "min-width") continue; // 폭 외 조건은 따지지 않는다
      const px = num(rawValue ?? "") * (/r?em\s*$/.test(rawValue ?? "") ? 16 : 1);
      if (!Number.isFinite(px)) continue;
      if (name === "max-width" ? DESKTOP_WIDTH > px : DESKTOP_WIDTH < px) return false;
    }
    return true;
  });
}

interface CssRule {
  selector: string;
  body: string;
}

/**
 * `<style>` 내용을 (선택자, 선언블록) 목록으로 편다. 중괄호 짝을 세므로
 * `@media`·`@supports` 안의 규칙도 제자리에서 꺼낸다 — 예전의 평면 정규식은
 * `@media all{.x{color:transparent}}`에서 선택자를 `@media all`로 읽어
 * 숨김 클래스를 놓쳤다(우회 3탄을 감싸기만 하면 통과).
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
 * 선택자 한 갈래가 "단순 선택자"(복합 하나)면 그 클래스들, 아니면 null.
 *
 * 조상·속성·의사 선택자가 붙은 규칙은 조건부라 여기서 다루지 않는다 —
 * `[data-ogsc] .logo{display:none}`(다크모드)나 `.mobile-only .cta{display:none}`
 * 를 무조건 숨김으로 읽으면 그 클래스를 쓴 정상 본문이 통째로 사라진다.
 */
function simpleSelectorClasses(selectorPart: string): string[] | null {
  const sel = selectorPart.trim();
  if (!sel || /[\s>+~[\]]/.test(sel) || /:{1,2}[-\w]/.test(sel)) return null;
  const classes = [...sel.matchAll(/\.([-\w]+)/g)].map((m) => m[1]);
  // 클래스 외의 것(태그·id)이 섞여 있으면 대상을 특정할 수 없다.
  return classes.length > 0 && sel.replace(/\.[-\w]+/g, "") === "" ? classes : null;
}

interface ClassHideRule {
  classes: string[];
  state: Map<HideProp, boolean>;
}

/**
 * `<style>` 규칙에서 클래스 조합별 가시성 상태를 모은다 — 인라인만 보면 숨김을
 * 클래스로 옮기는 것만으로 우회된다(실측: codex 3차). 같은 속성을 다시 지정한
 * 뒤 규칙이 이긴다(캐스케이드).
 */
function hiddenClassRules(html: string, kind: HideKind): ClassHideRule[] {
  const rules = new Map<string, ClassHideRule>();
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of cssRules(style[1])) {
      const state = visibilityState(rule.body, kind);
      if (state.size === 0) continue;
      for (const part of rule.selector.split(",")) {
        const classes = simpleSelectorClasses(part);
        if (!classes) continue;
        const key = [...classes].sort().join(".");
        const entry = rules.get(key) ?? { classes, state: new Map<HideProp, boolean>() };
        for (const [prop, hidden] of state) entry.state.set(prop, hidden);
        rules.set(key, entry);
      }
    }
  }
  // 숨기지 않는 규칙(`.copy{font-size:16px}`)도 남긴다 — 상속 숨김을 되돌리는
  // 자손을 알아보려면 "이 클래스는 보인다"는 정보가 필요하다.
  return [...rules.values()];
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 닫는 태그 없이 같은 태그가 다시 열리면 자동으로 닫히는 요소들. */
const AUTO_CLOSE_TAGS = new Set(["p", "li", "tr", "td", "th", "dd", "dt", "option"]);

/** 태그에 붙은 클래스 집합. */
function tagClasses(tag: string): Set<string> {
  const cls = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
  return new Set(cls ? cls[1].split(/\s+/).filter(Boolean) : []);
}

/** 클래스 규칙 + 인라인 스타일을 합친 요소의 가시성 상태 (인라인이 나중). */
function elementState(
  tag: string,
  rules: ClassHideRule[],
  kind: HideKind,
): Map<HideProp, boolean> {
  const state = new Map<HideProp, boolean>();
  if (rules.length > 0) {
    const have = tagClasses(tag);
    if (have.size > 0) {
      for (const rule of rules) {
        if (rule.classes.every((c) => have.has(c))) {
          for (const [prop, hidden] of rule.state) state.set(prop, hidden);
        }
      }
    }
  }
  const style = tag.match(/\bstyle\s*=\s*("[^"]*"|'[^']*')/i);
  if (style) for (const [prop, hidden] of visibilityState(style[1].slice(1, -1), kind)) {
    state.set(prop, hidden);
  }
  return state;
}

/** 여는 태그부터 요소가 끝나는 지점 — 내용 끝과 요소 끝. */
function elementBounds(html: string, m: RegExpExecArray): { contentEnd: number; end: number } {
  const name = m[1].toLowerCase();
  const afterOpen = m.index + m[0].length;
  if (m[0].endsWith("/>") || VOID_TAGS.has(name)) {
    return { contentEnd: afterOpen, end: afterOpen };
  }
  const pair = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, "gi");
  pair.lastIndex = afterOpen;
  let depth = 1;
  let nextSameTag = -1;
  let p: RegExpExecArray | null;
  while (depth > 0 && (p = pair.exec(html))) {
    if (p[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return { contentEnd: p.index, end: p.index + p[0].length };
    } else {
      if (nextSameTag < 0) nextSameTag = p.index;
      depth += 1;
    }
  }
  // 닫는 태그가 모자란 마크업 — 브라우저를 따른다: `<p>`·`<td>` 같은 요소는 다음
  // 같은 태그에서 자동으로 닫히고, 그 밖에는 문서 끝까지 이 요소 안이다.
  if (AUTO_CLOSE_TAGS.has(name) && nextSameTag >= 0) {
    return { contentEnd: nextSameTag, end: nextSameTag };
  }
  return { contentEnd: html.length, end: html.length };
}

/**
 * 상속 속성(font-size:0 등)으로만 숨겨진 요소의 내용에서, 그 속성을 다시 지정한
 * 자손만 남긴다 — `<td style="font-size:0;line-height:0">`는 이미지 사이 여백을
 * 없애는 관용구라 그 안의 `font-size:16px` 본문까지 지우면 정상 빌드가 "통짜
 * 이미지"로 몰린다.
 */
function keepOverriders(
  inner: string,
  hidden: HideProp[],
  rules: ClassHideRule[],
  kind: HideKind,
): string {
  const openTag = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = openTag.exec(inner))) {
    const state = elementState(m[0], rules, kind);
    if (!hidden.some((prop) => state.get(prop) === false)) continue; // 더 안쪽을 본다
    const { end } = elementBounds(inner, m);
    out += inner.slice(m.index, end);
    openTag.lastIndex = Math.max(end, m.index + m[0].length);
  }
  return out;
}

/** 숨겨진 요소를 내용째 제거한다. */
function stripHiddenBlocks(html: string, rules: ClassHideRule[], kind: HideKind): string {
  const openTag = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  for (;;) {
    openTag.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    let hidden: HideProp[] = [];
    while ((m = openTag.exec(html))) {
      hidden = hidingProps(elementState(m[0], rules, kind));
      if (hidden.length > 0) break;
    }
    if (!m) return html;
    const { contentEnd, end } = elementBounds(html, m);
    const inheritedOnly = hidden.every((prop) => INHERITED_HIDE.has(prop));
    const kept = inheritedOnly
      ? keepOverriders(html.slice(m.index + m[0].length, contentEnd), hidden, rules, kind)
      : "";
    html = html.slice(0, m.index) + kept + html.slice(end);
  }
}

/** 숨겨진 요소를 걷어낸 마크업 (kind에 따라 "글자가 안 보이는" 요소까지 제거). */
export function stripInvisible(html: string, kind: HideKind): string {
  // 숨김 클래스 수집은 <style> 제거 전의 원본에서 해야 한다.
  const rules = hiddenClassRules(html, kind);
  return stripHiddenBlocks(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, ""),
    rules,
    kind,
  );
}

/** 마크업·스타일·주석·숨김 요소를 걷어낸 "보이는" 텍스트의 비공백 글자 수. */
export function liveTextChars(html: string): number {
  return stripInvisible(html, "text")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, "")
    .replace(/\s+/g, "").length;
}

/** `<img src>` 값 (따옴표 제거). */
function imgSrc(tag: string): string | null {
  const m = tag.match(/\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/** 이미지 파일의 실측 크기 조회 (없으면 null). */
export type ImageSizeLookup = (src: string) => ImageSize | null;

export interface ImgContext {
  /** 파일에서 읽은 실측 크기 (세로비를 채우는 데 쓴다). */
  sizes?: ImageSizeLookup;
  /** `<style>`의 단순 클래스 규칙이 지정한 width — 클래스로 폭을 준 이미지용. */
  classWidths?: Map<string, string>;
  /** 전폭 기준(= 이메일 본문 폭). %로 준 폭을 px로 환산할 때도 쓴다. */
  canvasWidth?: number;
}

/** `<style>`의 단순 클래스 규칙에서 width 선언을 모은다. */
function classWidths(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of cssRules(style[1])) {
      const width = declarations(rule.body).findLast(([p]) => p === "width")?.[1];
      if (!width) continue;
      for (const part of rule.selector.split(",")) {
        const classes = simpleSelectorClasses(part);
        if (classes?.length === 1) out.set(classes[0], width);
      }
    }
  }
  return out;
}

/**
 * `<img>` 태그의 표시 크기. 속성·인라인 style·클래스 규칙에서 얻고, 빠진 축은
 * 파일의 실측 세로비로 채운다 — 이메일의 전폭 이미지는 대개
 * `width="700" height:auto`라 height 속성이 없어서(레퍼런스 발송본이 그렇다)
 * 태그만 보면 세로비를 알 수 없고, 그 상태로는 아래 두 검사가 무력화된다.
 * 반대로 실측 폭을 표시 폭으로 그대로 쓰면 2× 내보내기가 전폭으로 오인되므로,
 * 표시 폭은 마크업(px·%·클래스)에서만 읽고 실측은 비율로만 쓴다.
 */
function imgBox(tag: string, ctx: ImgContext = {}): { w: number; h: number } {
  const canvas = ctx.canvasWidth ?? DESKTOP_WIDTH;
  const declared = (name: "width" | "height"): number => {
    const raw =
      tag.match(new RegExp(`(?<![-\\w])${name}\\s*:\\s*([\\d.]+)\\s*(px|%)`, "i"))?.slice(1) ??
      tag.match(new RegExp(`(?<![-\\w])${name}\\s*=\\s*["']?([\\d.]+)\\s*(%?)`, "i"))?.slice(1) ??
      (name === "width" ? classWidthOf(tag, ctx.classWidths) : null);
    if (!raw) return Number.NaN;
    const value = num(raw[0]);
    // 세로 %는 이메일에서 의미가 없다.
    if (raw[1] === "%") return name === "width" ? (canvas * value) / 100 : Number.NaN;
    return value;
  };
  // 0·1px은 표시 크기로 신뢰하지 않는다 — `height="0"` 한 줄로 검사를 끄는 길이
  // 열린다(브라우저는 style의 height:auto를 따르므로 렌더에는 영향이 없다).
  let w = declared("width") > 1 ? declared("width") : Number.NaN;
  let h = declared("height") > 1 ? declared("height") : Number.NaN;
  const src = imgSrc(tag);
  const intrinsic = src ? (ctx.sizes?.(src) ?? null) : null;
  if (intrinsic) {
    // 레티나(2×) 내보내기여도 세로비는 같다 — 비율만 빌려 쓴다.
    if (!Number.isFinite(w) && !Number.isFinite(h)) ({ w, h } = intrinsic);
    else if (!Number.isFinite(h)) h = (w * intrinsic.h) / intrinsic.w;
    else if (!Number.isFinite(w)) w = (h * intrinsic.w) / intrinsic.h;
  }
  return { w, h };
}

/** 클래스 규칙이 지정한 width 값 ([값, 단위]). */
function classWidthOf(tag: string, widths?: Map<string, string>): [string, string] | null {
  if (!widths || widths.size === 0) return null;
  for (const cls of tagClasses(tag)) {
    const raw = widths.get(cls);
    const m = raw?.match(/^([\d.]+)\s*(px|%)/);
    if (m) return [m[1], m[2]];
  }
  return null;
}

/**
 * 페이지 스크린샷 의심 이미지 — 폭 400px 이상이면서 세로비(h/w) 2 이상인
 * 단일 이미지는 이메일 전체/대부분을 담은 캡처다 (실측: 통짜 700×2207 =
 * 3.15, 정상 최대치인 히어로 700×385 = 0.55 · CTA 700×234 = 0.33).
 */
export function findScreenshotLikeImages(html: string, ctx: ImgContext = {}): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgBox(m[0], ctx);
    if (w >= 400 && h / w >= 2) hits.push(imgSrc(m[0]) ?? "(unknown src)");
  }
  return hits;
}

/**
 * 전폭 이미지가 이메일 세로를 얼마나 덮는지 — 스크린샷을 섹션 조각으로 썰면
 * 개별 세로비 검사는 피해가지만(실측: codex 3차, 7조각 슬라이스) 합계는
 * 숨길 수 없다. 세로비(h/w) 합으로 계산해 레퍼런스가 2× 렌더여도 불변이다.
 * 정직한 빌드는 레이어드 아트 섹션만 이미지라 ~28%, 전체 슬라이스는 ~100%.
 */
export function fullWidthImageAspectSum(html: string, ctx: ImgContext = {}): number {
  let sum = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgBox(m[0], ctx);
    if (w >= 400 && Number.isFinite(h)) sum += h / w;
  }
  return sum;
}

/**
 * HTML이 참조하는 상대경로 이미지의 실측 크기 표 (파일당 1회 읽기).
 * output/ 밖은 읽지 않는다.
 */
async function imageSizes(
  root: string,
  htmlFile: string,
  html: string,
): Promise<ImageSizeLookup> {
  const srcs = new Set<string>();
  const sizes = new Map<string, ImageSize>();
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = imgSrc(tag[0]);
    if (!src) continue;
    // 셀프컨테인 산출물은 이미지를 base64로 품는다 — 그대로 디코드해 잰다.
    const inline = src.match(/^data:image\/[-\w.+]+;base64,([\s\S]*)$/i);
    if (inline) {
      // 앞부분만 디코드하면 ICC/EXIF 뒤에 오는 JPEG 프레임 헤더를 놓친다.
      const size = imageSize(Buffer.from(inline[1], "base64"));
      if (size) sizes.set(src, size);
    } else if (!/^(https?:|data:|cid:|\/\/|#)/i.test(src)) {
      srcs.add(src);
    }
  }
  await Promise.all(
    [...srcs].map(async (src) => {
      let file: string;
      try {
        file = path.resolve(path.dirname(htmlFile), decodeURIComponent(src.split(/[?#]/)[0]));
      } catch {
        return;
      }
      if (!file.startsWith(root + path.sep)) return;
      const buf = await readFile(file).catch(() => null);
      const size = buf && imageSize(buf);
      if (size) sizes.set(src, size);
    }),
  );
  return (src) => sizes.get(src) ?? null;
}

const MAX_FULL_WIDTH_IMAGE_COVERAGE = 0.7;

/** 파일에서 픽셀 크기를 읽는다. 없거나 해석 불가면 null. */
async function fileImageSize(file: string): Promise<ImageSize | null> {
  const buf = await readFile(file).catch(() => null);
  return buf ? imageSize(buf) : null;
}

export interface AcceptanceOptions {
  /**
   * false면 verify FAIL을 실패가 아닌 경고로 강등한다 — 부분 수정(edit) 잡은
   * 의도적으로 원본 Figma와 달라지므로 PASS를 강제할 수 없다. 검증을
   * 실행했다는 사실(증거물 + verify.json 존재)은 여전히 요구한다.
   */
  requireVerifyPass?: boolean;
  /**
   * 이 시각 이후에 쓰인 verify.json만 이번 실행의 증거로 인정한다. edit 잡은
   * 원본 workDir을 복사해 오고 resume은 같은 workDir을 재사용하므로, 지정하지
   * 않으면 이전 실행이 남긴 PASS만으로 게이트를 통과할 수 있다.
   */
  freshSince?: number;
}

/** 파일 메타데이터, 없으면 null. */
async function statOrNull(file: string) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

export async function checkAcceptance(
  jobId: string,
  opts: AcceptanceOptions = {},
): Promise<Acceptance> {
  const requireVerifyPass = opts.requireVerifyPass ?? true;
  const failures: string[] = [];
  const warnings: string[] = [];
  const base = workDir(jobId);
  const out = outputDir(jobId);

  const outFiles = existsSync(out) ? await readdir(out, { recursive: true }) : [];
  const htmls = outFiles.map(String).filter((f) => f.endsWith(".html"));
  for (const [suffix, label] of [
    ["_figma.html", "Figma 원본 충실본(*_figma.html)"],
    ["_responsive.html", "반응형 변형(*_responsive.html)"],
  ] as const) {
    const file = htmls.find((f) => f.endsWith(suffix));
    if (!file) {
      failures.push(`output/에 ${label}이 없습니다.`);
      continue;
    }
    const htmlFile = path.join(out, file);
    const html = await readFile(htmlFile, "utf8");
    const chars = liveTextChars(html);
    if (chars < MIN_LIVE_TEXT_CHARS) {
      failures.push(
        `${file}의 "보이는" 라이브 텍스트가 ${chars}자뿐입니다 — 이메일 전체를 이미지로 굽는 방식은 거부됩니다. ` +
          `숨김 요소(display:none, clip, 1px 등)의 텍스트는 세지 않습니다. 플랫 이미지는 레이어드 아트 섹션` +
          `(히어로/배너/CTA 배경)에만 허용되며, 본문 카피는 반드시 화면에 보이는 실제 HTML 텍스트로 구현하세요.`,
      );
    }
    // 이미지 검사는 실제로 렌더되는 이미지만 센다 — 반응형 산출물은 같은 아트를
    // 데스크톱/모바일 두 벌로 싣고 한쪽을 숨기므로, 숨긴 쪽까지 세면 커버리지가
    // 두 배로 부풀어 정상 빌드가 "슬라이스"로 거부된다.
    const canvas = await fileImageSize(path.join(base, "figma_full.png"));
    const rendered = stripInvisible(html, "layout");
    const imgCtx: ImgContext = {
      sizes: await imageSizes(out, htmlFile, rendered),
      classWidths: classWidths(html),
      canvasWidth: canvas?.w,
    };
    const screenshots = findScreenshotLikeImages(rendered, imgCtx);
    if (screenshots.length > 0) {
      failures.push(
        `${file}에 페이지 스크린샷으로 보이는 이미지가 있습니다 (폭 400px 이상 + 세로비 2 이상): ` +
          `${screenshots.join(", ")} — 디자인 전체·대부분을 한 장의 이미지로 넣는 방식은 거부됩니다. ` +
          `섹션별로 나누고 본문 카피는 보이는 HTML 텍스트로 구현하세요.`,
      );
    }
    if (canvas && canvas.w > 0 && canvas.h > 0) {
      const coverage = fullWidthImageAspectSum(rendered, imgCtx) / (canvas.h / canvas.w);
      if (coverage > MAX_FULL_WIDTH_IMAGE_COVERAGE) {
        failures.push(
          `${file}의 전폭 이미지(폭 400px 이상)가 이메일 세로의 ${Math.round(coverage * 100)}%를 덮습니다 ` +
            `(허용 ${MAX_FULL_WIDTH_IMAGE_COVERAGE * 100}%) — 디자인을 이미지 조각으로 슬라이스한 산출물은 거부됩니다. ` +
            `플랫 이미지는 레이어드 아트 섹션(히어로/배너/CTA 배경)에만 쓰고, 텍스트 섹션은 실제 HTML로 구현하세요.`,
        );
      }
    }
  }

  // 0바이트 파일은 없는 것으로 친다 — compare.py가 쓰다 죽으면 그렇게 남는다.
  const evidence = await Promise.all(
    VERIFY_EVIDENCE.map(async (f) => ({ f, st: await statOrNull(path.join(base, f)) })),
  );
  const missingEvidence = evidence.filter(({ st }) => !st || st.size === 0).map(({ f }) => f);
  if (missingEvidence.length > 0) {
    failures.push(
      `픽셀 검증 증거물이 작업 루트에 없거나 비어 있습니다: ${missingEvidence.join(", ")} — compare.py 검증 단계를 실행하세요.`,
    );
  }

  const verify = await readVerifySummary(jobId);
  const verifyStat = await statOrNull(path.join(base, "verify.json"));
  const stale =
    opts.freshSince !== undefined && (!verifyStat || verifyStat.mtimeMs < opts.freshSince);
  if (!verify) {
    failures.push(
      "verify.json이 없거나 읽을 수 없습니다 — compare.py(검증 단계)가 작업 루트에 남겨야 합니다.",
    );
  } else if (stale) {
    failures.push(
      "verify.json이 이번 실행에서 갱신되지 않았습니다 — 이전 실행이 남긴 결과입니다. compare.py 검증 단계를 다시 실행하세요.",
    );
  } else if (verify.result !== "PASS") {
    const detail = [
      verify.overall !== undefined ? `overall ${verify.overall}%` : null,
      verify.heightDelta !== undefined ? `height Δ ${verify.heightDelta}px` : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (requireVerifyPass) {
      failures.push(
        `픽셀 검증 결과가 FAIL입니다${detail ? ` (${detail})` : ""} — PASS까지 빌드를 수정하세요.`,
      );
    } else {
      warnings.push(
        `픽셀 검증이 원본 Figma와 다릅니다${detail ? ` (${detail})` : ""} — 의도한 수정이 반영된 결과라면 정상입니다.`,
      );
    }
  }

  const imagesDir = path.join(out, "images");
  const imageCount = existsSync(imagesDir) ? (await readdir(imagesDir)).length : 0;
  if (imageCount === 0) {
    warnings.push("output/images/가 비어 있습니다 — 디자인에 이미지가 없다면 정상입니다.");
  }

  return { ok: failures.length === 0, failures, warnings, verify };
}
