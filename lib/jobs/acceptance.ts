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
 * 선언 블록이 요소를 숨기는지/명시적으로 보이게 하는지. 어느 쪽도 아니면 null.
 *
 * 속성명을 정확히 비교한다 — 예전 구현은 하나의 정규식으로 값만 훑어
 * `background-color:transparent`나 `margin-left:-100px` 같은 평범한 선언까지
 * 숨김으로 읽고 정상 산출물의 본문을 통째로 지웠다.
 */
function declaredVisibility(css: string, kind: HideKind): "hidden" | "visible" | null {
  const decls = declarations(css);
  const get = (prop: string) => decls.findLast(([p]) => p === prop)?.[1];
  const positioned = /^(absolute|fixed)/.test(get("position") ?? "");
  let visible = false;

  for (const [prop, value] of decls) {
    switch (prop) {
      case "display":
        if (value.startsWith("none")) return "hidden";
        visible = true;
        break;
      case "visibility":
        if (value.startsWith("hidden") || value.startsWith("collapse")) return "hidden";
        visible = true;
        break;
      case "opacity":
        if (num(value) === 0) return "hidden";
        if (num(value) > 0) visible = true;
        break;
      case "clip":
        if (/rect\(\s*0/.test(value)) return "hidden";
        break;
      case "mso-hide":
        if (value.startsWith("all")) return "hidden";
        break;
      // 화면 밖으로 밀어내는 관용구 — position이 걸려 있을 때만 실제로 숨겨진다.
      case "left":
      case "top":
        if (positioned && num(value) <= -100) return "hidden";
        break;
      case "font-size":
        if (kind === "text" && num(value) === 0) return "hidden";
        if (num(value) > 0) visible = true;
        break;
      case "color":
        if (kind === "text" && /^(transparent|rgba\([^)]*,\s*0(\.0+)?\s*\))/.test(value)) {
          return "hidden";
        }
        if (kind === "text") visible = true;
        break;
      case "text-indent":
        if (kind === "text" && num(value) <= -100) return "hidden";
        break;
    }
  }
  // 1px 클리핑(sr-only)은 가로·세로가 모두 잠길 때만 — height:1px 구분선은 정상이다.
  const box = (prop: string) => {
    const v = get(prop);
    return v !== undefined && !v.includes("%") ? num(v) : NaN;
  };
  if (box("width") <= 1 && box("height") <= 1) return "hidden";
  return visible ? "visible" : null;
}

/** 데스크톱 렌더 기준 — 픽셀 검증이 비교하는 것이 이 폭의 렌더다. */
const DESKTOP_WIDTH = 700;

/**
 * `@media` 질의가 데스크톱 렌더에 적용되는지. 모바일 전용 규칙
 * (`max-width:600px`)의 `display:none`을 숨김으로 읽으면 정상 반응형 산출물의
 * 데스크톱 콘텐츠가 통째로 사라진다. 해석할 수 없는 질의는 "적용 안 함"으로
 * 본다 — 오탐(정상 빌드 실패)이 미탐보다 비싸다.
 */
function mediaApplies(prelude: string): boolean {
  const query = prelude.replace(/^@media/i, "").trim().toLowerCase();
  if (!query) return true;
  return query.split(",").some((one) => {
    if (/\bprint\b/.test(one) && !/\b(screen|all)\b/.test(one)) return false;
    for (const cond of one.matchAll(/\(([^)]*)\)/g)) {
      const [name, raw] = cond[1].split(":").map((s) => s.trim());
      const px = num(raw ?? "") * (/r?em\s*$/.test(raw ?? "") ? 16 : 1);
      if (!Number.isFinite(px)) return false;
      if (name === "max-width" && DESKTOP_WIDTH > px) return false;
      else if (name === "min-width" && DESKTOP_WIDTH < px) return false;
      else if (name !== "max-width" && name !== "min-width") return false;
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

/** 선택자 한 갈래의 마지막 복합 선택자에 붙은 클래스들 (그 요소가 숨김 대상). */
function targetClasses(selectorPart: string): string[] {
  const last = selectorPart.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
  if (/:{1,2}[-\w]/.test(last)) return []; // `.btn:hover{display:none}`은 기본 상태가 아니다
  return [...last.matchAll(/\.([-\w]+)/g)].map((m) => m[1]);
}

/**
 * `<style>` 규칙에서 "이 클래스들을 모두 가진 요소는 숨김"인 조합을 모은다 —
 * 인라인만 보면 숨김을 클래스로 옮기는 것만으로 우회된다(실측: codex 3차).
 * 뒤에 오는 규칙이 다시 보이게 하면 취소한다(캐스케이드: 나중 규칙이 이긴다).
 */
function hiddenClassRules(html: string, kind: HideKind): string[][] {
  const rules = new Map<string, string[]>();
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of cssRules(style[1])) {
      const vis = declaredVisibility(rule.body, kind);
      if (!vis) continue;
      for (const part of rule.selector.split(",")) {
        const classes = targetClasses(part);
        if (classes.length === 0) continue;
        const key = [...classes].sort().join(".");
        if (vis === "hidden") rules.set(key, classes);
        else rules.delete(key);
      }
    }
  }
  return [...rules.values()];
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 인라인 스타일 또는 숨김 클래스로 숨겨진 요소를 내용째 제거한다 (같은 태그 중첩 감안). */
function stripHiddenBlocks(html: string, hiddenCls: string[][], kind: HideKind): string {
  const openTag = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  const isHidden = (tag: string): boolean => {
    const style = tag.match(/\bstyle\s*=\s*("[^"]*"|'[^']*')/i);
    if (style && declaredVisibility(style[1].slice(1, -1), kind) === "hidden") return true;
    if (hiddenCls.length === 0) return false;
    const cls = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
    if (!cls) return false;
    const have = new Set(cls[1].split(/\s+/).filter(Boolean));
    return hiddenCls.some((need) => need.every((c) => have.has(c)));
  };
  for (;;) {
    openTag.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    while ((m = openTag.exec(html))) if (isHidden(m[0])) break;
    if (!m) return html;
    const tag = m[1].toLowerCase();
    const dropTagOnly = () => {
      html = html.slice(0, m!.index) + html.slice(m!.index + m![0].length);
    };
    if (m[0].endsWith("/>") || VOID_TAGS.has(tag)) {
      dropTagOnly();
      continue;
    }
    // 같은 이름의 여는/닫는 태그를 세며 짝이 맞는 닫는 태그까지 제거.
    const pair = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
    pair.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    let nextSameTag = -1; // 닫히지 않은 `<p>…<p>`가 자동으로 닫히는 지점
    let p: RegExpExecArray | null;
    while (depth > 0 && (p = pair.exec(html))) {
      if (!p[0].startsWith("</") && nextSameTag < 0) nextSameTag = p.index;
      depth += p[0].startsWith("</") ? -1 : 1;
      end = p.index + p[0].length;
    }
    if (depth === 0) {
      html = html.slice(0, m.index) + html.slice(end);
    } else if (nextSameTag >= 0) {
      // 닫는 태그가 모자라면 다음 같은 태그가 열리는 지점까지만 — 브라우저도
      // `<p>`·`<td>` 등을 그렇게 자동으로 닫는다.
      html = html.slice(0, m.index) + html.slice(nextSameTag);
    } else {
      // 짝도 후속 태그도 없는 마크업: 여는 태그만 지운다. 문서 뒷부분을 통째로
      // 버리면 정상 산출물의 본문이 사라져 게이트가 잘못 실패한다.
      dropTagOnly();
    }
  }
}

/** 숨겨진 요소를 걷어낸 마크업 (kind에 따라 "글자가 안 보이는" 요소까지 제거). */
export function stripInvisible(html: string, kind: HideKind): string {
  // 숨김 클래스 수집은 <style> 제거 전의 원본에서 해야 한다.
  const hiddenCls = hiddenClassRules(html, kind);
  return stripHiddenBlocks(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, ""),
    hiddenCls,
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

/**
 * `<img>` 태그의 표시 크기. 속성/인라인 style에서 얻고, 빠진 축은 파일의 실측
 * 세로비로 채운다 — 이메일의 전폭 이미지는 대개 `width="700" height:auto`라
 * height 속성이 없어서(레퍼런스 발송본이 그렇다) 태그만 보면 세로비를 알 수
 * 없고, 그 상태로는 아래 두 검사가 조용히 무력화된다.
 */
function imgBox(tag: string, sizes?: ImageSizeLookup): { w: number; h: number } {
  // `width="100%"`처럼 px가 아닌 값은 숫자로 읽지 않는다.
  const attr = (name: string) =>
    tag.match(new RegExp(`(?<![-\\w])${name}\\s*=\\s*["']?(\\d+)\\s*(?![\\d.%])`, "i"))?.[1] ??
    tag.match(new RegExp(`(?<![-\\w])${name}\\s*:\\s*(\\d+)\\s*px`, "i"))?.[1];
  let w = Number(attr("width"));
  let h = Number(attr("height"));
  const src = imgSrc(tag);
  const intrinsic = src ? (sizes?.(src) ?? null) : null;
  if (intrinsic) {
    // 레티나(2×) 내보내기여도 세로비는 같다 — 비율만 빌려 쓴다.
    if (!Number.isFinite(w) && !Number.isFinite(h)) ({ w, h } = intrinsic);
    else if (!Number.isFinite(h)) h = (w * intrinsic.h) / intrinsic.w;
    else if (!Number.isFinite(w)) w = (h * intrinsic.w) / intrinsic.h;
  }
  return { w, h };
}

/**
 * 페이지 스크린샷 의심 이미지 — 폭 400px 이상이면서 세로비(h/w) 2 이상인
 * 단일 이미지는 이메일 전체/대부분을 담은 캡처다 (실측: 통짜 700×2207 =
 * 3.15, 정상 최대치인 히어로 700×385 = 0.55 · CTA 700×234 = 0.33).
 */
export function findScreenshotLikeImages(html: string, sizes?: ImageSizeLookup): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgBox(m[0], sizes);
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
export function fullWidthImageAspectSum(html: string, sizes?: ImageSizeLookup): number {
  let sum = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgBox(m[0], sizes);
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
      // 헤더만 있으면 되므로 앞부분만 디코드한다 (4의 배수라 경계가 맞는다).
      const size = imageSize(Buffer.from(inline[1].slice(0, 4096), "base64"));
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
    const rendered = stripInvisible(html, "layout");
    const sizes = await imageSizes(out, htmlFile, rendered);
    const screenshots = findScreenshotLikeImages(rendered, sizes);
    if (screenshots.length > 0) {
      failures.push(
        `${file}에 페이지 스크린샷으로 보이는 이미지가 있습니다 (폭 400px 이상 + 세로비 2 이상): ` +
          `${screenshots.join(", ")} — 디자인 전체·대부분을 한 장의 이미지로 넣는 방식은 거부됩니다. ` +
          `섹션별로 나누고 본문 카피는 보이는 HTML 텍스트로 구현하세요.`,
      );
    }
    const canvas = await fileImageSize(path.join(base, "figma_full.png"));
    if (canvas && canvas.w > 0 && canvas.h > 0) {
      const coverage = fullWidthImageAspectSum(rendered, sizes) / (canvas.h / canvas.w);
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
