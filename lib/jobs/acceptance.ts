import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
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

const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|clip\s*:\s*rect\(\s*0|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d])|mso-hide\s*:\s*all|color\s*:\s*transparent|text-indent\s*:\s*-|(?:left|top)\s*:\s*-\d{3}/i;

/**
 * `<style>` 블록에서 숨김 선언을 가진 클래스명을 수집한다 — 인라인 스타일만
 * 검사하면 숨김을 클래스로 옮기는 것만으로 우회된다 (실측: codex 3차,
 * `.email-copy{color:transparent;width:1px}`).
 */
function hiddenClassNames(html: string): Set<string> {
  const names = new Set<string>();
  for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of style[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!HIDDEN_STYLE.test(rule[2])) continue;
      for (const cls of rule[1].matchAll(/\.([-\w]+)/g)) names.add(cls[1]);
    }
  }
  return names;
}

/** 인라인 스타일 또는 숨김 클래스로 숨겨진 요소를 내용째 제거한다 (같은 태그 중첩 감안). */
function stripHiddenBlocks(html: string, hiddenCls: Set<string>): string {
  const openTag = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  const isHidden = (tag: string): boolean => {
    const style = tag.match(/\bstyle\s*=\s*("[^"]*"|'[^']*')/i);
    if (style && HIDDEN_STYLE.test(style[1])) return true;
    const cls = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
    return cls !== null && cls[1].split(/\s+/).some((c) => hiddenCls.has(c));
  };
  for (;;) {
    openTag.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    while ((m = openTag.exec(html))) if (isHidden(m[0])) break;
    if (!m) return html;
    const tag = m[1].toLowerCase();
    if (m[0].endsWith("/>") || tag === "img" || tag === "br") {
      html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
      continue;
    }
    // 같은 이름의 여는/닫는 태그를 세며 짝이 맞는 닫는 태그까지 제거.
    const pair = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
    pair.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    let p: RegExpExecArray | null;
    while (depth > 0 && (p = pair.exec(html))) {
      depth += p[0].startsWith("</") ? -1 : 1;
      end = p.index + p[0].length;
    }
    html = html.slice(0, m.index) + html.slice(end);
  }
}

/** 마크업·스타일·주석·숨김 요소를 걷어낸 "보이는" 텍스트의 비공백 글자 수. */
export function liveTextChars(html: string): number {
  // 숨김 클래스 수집은 <style> 제거 전의 원본에서 해야 한다.
  const hiddenCls = hiddenClassNames(html);
  return stripHiddenBlocks(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, ""),
    hiddenCls,
  )
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, "")
    .replace(/\s+/g, "").length;
}

/** `<img>` 태그의 표시 크기 (width/height 속성 또는 인라인 style px). */
function imgDisplaySize(tag: string): { w: number; h: number } {
  const attr = (name: string) =>
    tag.match(new RegExp(`(?<![-\\w])${name}\\s*=\\s*["']?(\\d+)`, "i"))?.[1] ??
    tag.match(new RegExp(`(?<![-\\w])${name}\\s*:\\s*(\\d+)px`, "i"))?.[1];
  return { w: Number(attr("width")), h: Number(attr("height")) };
}

/**
 * 페이지 스크린샷 의심 이미지 — 폭 400px 이상이면서 세로비(h/w) 2 이상인
 * 단일 이미지는 이메일 전체/대부분을 담은 캡처다 (실측: 통짜 700×2207 =
 * 3.15, 정상 최대치인 히어로 700×385 = 0.55 · CTA 700×234 = 0.33).
 */
export function findScreenshotLikeImages(html: string): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgDisplaySize(m[0]);
    if (w >= 400 && h / w >= 2) {
      hits.push(m[0].match(/src\s*=\s*["']?([^"' >]+)/i)?.[1] ?? "(unknown src)");
    }
  }
  return hits;
}

/**
 * 전폭 이미지가 이메일 세로를 얼마나 덮는지 — 스크린샷을 섹션 조각으로 썰면
 * 개별 세로비 검사는 피해가지만(실측: codex 3차, 7조각 슬라이스) 합계는
 * 숨길 수 없다. 세로비(h/w) 합으로 계산해 레퍼런스가 2× 렌더여도 불변이다.
 * 정직한 빌드는 레이어드 아트 섹션만 이미지라 ~28%, 전체 슬라이스는 ~100%.
 */
export function fullWidthImageAspectSum(html: string): number {
  let sum = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const { w, h } = imgDisplaySize(m[0]);
    if (w >= 400 && Number.isFinite(h)) sum += h / w;
  }
  return sum;
}

const MAX_FULL_WIDTH_IMAGE_COVERAGE = 0.7;

/** PNG IHDR에서 픽셀 크기를 읽는다 (서명 8B + 길이/타입 8B + W4B + H4B). */
async function pngSize(file: string): Promise<{ w: number; h: number } | null> {
  try {
    const buf = await readFile(file);
    if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
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
    const html = await readFile(path.join(out, file), "utf8");
    const chars = liveTextChars(html);
    if (chars < MIN_LIVE_TEXT_CHARS) {
      failures.push(
        `${file}의 "보이는" 라이브 텍스트가 ${chars}자뿐입니다 — 이메일 전체를 이미지로 굽는 방식은 거부됩니다. ` +
          `숨김 요소(display:none, clip, 1px 등)의 텍스트는 세지 않습니다. 플랫 이미지는 레이어드 아트 섹션` +
          `(히어로/배너/CTA 배경)에만 허용되며, 본문 카피는 반드시 화면에 보이는 실제 HTML 텍스트로 구현하세요.`,
      );
    }
    const screenshots = findScreenshotLikeImages(html);
    if (screenshots.length > 0) {
      failures.push(
        `${file}에 페이지 스크린샷으로 보이는 이미지가 있습니다 (폭 400px 이상 + 세로비 2 이상): ` +
          `${screenshots.join(", ")} — 디자인 전체·대부분을 한 장의 이미지로 넣는 방식은 거부됩니다. ` +
          `섹션별로 나누고 본문 카피는 보이는 HTML 텍스트로 구현하세요.`,
      );
    }
    const canvas = await pngSize(path.join(base, "figma_full.png"));
    if (canvas && canvas.w > 0 && canvas.h > 0) {
      const coverage = fullWidthImageAspectSum(html) / (canvas.h / canvas.w);
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
