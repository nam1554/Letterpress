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
  if (!htmls.some((f) => f.endsWith("_figma.html"))) {
    failures.push("output/에 Figma 원본 충실본(*_figma.html)이 없습니다.");
  }
  if (!htmls.some((f) => f.endsWith("_responsive.html"))) {
    failures.push("output/에 반응형 변형(*_responsive.html)이 없습니다.");
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
