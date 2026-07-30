import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { measureHtmlFiles } from "./measure";
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

/** 크기 판정에 필요한 최소 정보 (브라우저가 렌더한 표시 크기). */
export interface RenderedImage {
  src: string;
  width: number;
  height: number;
}

/**
 * 페이지 스크린샷 의심 이미지 — 폭 400px 이상이면서 세로비(h/w) 2 이상인
 * 단일 이미지는 이메일 전체/대부분을 담은 캡처다 (실측: 통짜 700×2207 =
 * 3.15, 정상 최대치인 히어로 700×385 = 0.55 · CTA 700×234 = 0.33).
 * 크기는 브라우저가 렌더한 실제 표시 크기다 — 마크업으로 추정하지 않는다.
 */
export function findScreenshotLikeImages(images: readonly RenderedImage[]): string[] {
  return images
    .filter(({ width, height }) => width >= 400 && height / width >= 2)
    .map(({ src }) => src || "(unknown src)");
}

/**
 * 전폭 이미지가 이메일 세로를 얼마나 덮는지 — 스크린샷을 섹션 조각으로 썰면
 * 개별 세로비 검사는 피해가지만(실측: codex 3차, 7조각 슬라이스) 합계는
 * 숨길 수 없다. 세로비(h/w) 합으로 계산해 레퍼런스가 2× 렌더여도 불변이다.
 * 정직한 빌드는 레이어드 아트 섹션만 이미지라 ~28%, 전체 슬라이스는 ~100%.
 */
export function fullWidthImageAspectSum(images: readonly RenderedImage[]): number {
  let sum = 0;
  for (const { width, height } of images) {
    if (width >= 400) sum += height / width;
  }
  return sum;
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
  /**
   * 잡의 취소·제한 시간 신호. 게이트는 산출물을 헤드리스 Chrome으로 렌더하므로,
   * 이미 멈춘 잡에서 이 작업이 계속되면 종료 상태(취소/시간 초과)가 측정이
   * 끝날 때까지 밀려 사용자는 "실행 중"만 계속 본다.
   */
  signal?: AbortSignal;
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
  const deliverables: string[] = [];
  for (const [suffix, label] of [
    ["_figma.html", "Figma 원본 충실본(*_figma.html)"],
    ["_responsive.html", "반응형 변형(*_responsive.html)"],
  ] as const) {
    // output/ 최상단을 먼저 본다 — hosted/(CDN URL 치환본)이 먼저 잡히면
    // 원격 이미지 검사에 걸려 정상 빌드가 실패한다.
    const file =
      htmls.find((f) => !f.includes(path.sep) && f.endsWith(suffix)) ??
      htmls.find((f) => f.endsWith(suffix));
    if (!file) failures.push(`output/에 ${label}이 없습니다.`);
    else deliverables.push(file);
  }

  // 실제 브라우저로 렌더해 잰다 — 보이는 텍스트와 이미지 표시 크기는 마크업만
  // 보고 계산할 수 없다(표 자동 레이아웃·캐스케이드·미디어쿼리).
  // 두 산출물을 한 번의 브라우저 기동으로 처리한다 — 파일마다 새로 띄우면
  // 잡·테스트가 동시에 돌 때 머신이 Chrome 여러 개로 막힌다.
  // 캔버스 크기(PNG 헤더 읽기)는 측정 결과에 들어가지 않고 그 반대도 아니므로
  // 함께 출발시킨다 — 안 그러면 헤드리스 Chrome 기동 앞에 파일 읽기 지연이
  // 매 게이트 실행마다 그대로 더해진다.
  const [canvas, measurements] = await Promise.all([
    fileImageSize(path.join(base, "figma_full.png")),
    deliverables.length
      ? measureHtmlFiles(
          deliverables.map((f) => path.join(out, f)),
          { signal: opts.signal },
        )
      : [],
  ]);

  for (const [index, file] of deliverables.entries()) {
    const measured = measurements[index];
    if (!measured.ok) {
      if (measured.reason === "render-failed") {
        // 렌더가 안 되는 산출물은 "판정 불가"가 아니라 불량이다 — 여기서 경고로
        // 넘기면 load를 막는 스크립트 한 줄로 반-우회 검사 3개를 전부 끌 수 있다
        // (실측 재현). 이메일 클라이언트에서 열리지 않는 파일이기도 하다.
        failures.push(
          `${file}을 브라우저에서 열지 못했습니다 (${measured.detail ?? "렌더 실패"}) — ` +
            `산출물은 브라우저에서 그대로 렌더돼야 합니다. 로딩을 막는 스크립트나 깨진 마크업이 없는지 확인하세요.`,
        );
      } else {
        // Chrome 부재·잡 취소 — 판정 불가는 실패로 다루지 않는다.
        // 검증 증거물 검사가 이미 Chrome 부재를 별도로 잡는다.
        warnings.push(
          `${file}의 라이브 텍스트·이미지 검사를 건너뜁니다 ` +
            `(${measured.reason === "aborted" ? "실행이 중단됨" : "Chrome을 찾지 못함"}).`,
        );
      }
      continue;
    }
    // 원격 이미지는 요청을 끊으므로 크기를 신뢰할 수 없다 — 깨진 이미지가
    // 정사각형 상자로 측정돼 통짜 캡처가 세로비 검사를 통과했다(실측 재현).
    // 1x1 추적 픽셀 같은 작은 것은 렌더 크기가 작아 애초에 걸리지 않는다.
    const unloadable = measured.images.filter((i) => !i.loaded && i.width >= 400);
    if (unloadable.length > 0) {
      failures.push(
        `${file}의 전폭 이미지를 불러올 수 없습니다: ${unloadable.map((i) => i.src || "(src 없음)").join(", ")} — ` +
          `output/의 HTML은 images/ 아래 로컬 상대경로를 참조해야 합니다. ` +
          `원격 URL은 크기를 검증할 수 없어 통짜 캡처를 숨길 수 있습니다 (CDN 치환본은 hosted/에 따로 만듭니다).`,
      );
    }
    // 크기 검사는 실제로 디코드된 이미지만 대상으로 한다 (위에서 이미 거부).
    const rendered = measured.images.filter((i) => i.loaded);
    if (measured.textChars < MIN_LIVE_TEXT_CHARS) {
      failures.push(
        `${file}의 "보이는" 라이브 텍스트가 ${measured.textChars}자뿐입니다 — 이메일 전체를 이미지로 굽는 방식은 거부됩니다. ` +
          `숨김 요소(display:none, clip, 1px, 투명 글자 등)의 텍스트는 세지 않습니다. 플랫 이미지는 레이어드 아트 섹션` +
          `(히어로/배너/CTA 배경)에만 허용되며, 본문 카피는 반드시 화면에 보이는 실제 HTML 텍스트로 구현하세요.`,
      );
    }
    const screenshots = findScreenshotLikeImages(rendered);
    if (screenshots.length > 0) {
      failures.push(
        `${file}에 페이지 스크린샷으로 보이는 이미지가 있습니다 (폭 400px 이상 + 세로비 2 이상): ` +
          `${screenshots.join(", ")} — 디자인 전체·대부분을 한 장의 이미지로 넣는 방식은 거부됩니다. ` +
          `섹션별로 나누고 본문 카피는 보이는 HTML 텍스트로 구현하세요.`,
      );
    }
    if (canvas && canvas.w > 0 && canvas.h > 0) {
      const coverage = fullWidthImageAspectSum(rendered) / (canvas.h / canvas.w);
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
