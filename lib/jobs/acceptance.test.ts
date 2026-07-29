import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-acceptance-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { checkAcceptance, liveTextChars, readVerifySummary } from "./acceptance";
import { createJob, outputDir, workDir } from "./store";

const PASS_JSON = JSON.stringify({
  result: "PASS",
  overall: 97.3,
  height_delta: 2,
  bands: [{ name: "header", sim: 99.1, shift: 0, ok: true }],
});

// 게이트의 라이브 텍스트 최소량(100자)을 넘는 정상 산출물 본문.
const SAMPLE_HTML = `<html><body><table><tr><td>
아이서퍼 고객님, 이제 문의는 채널톡으로 편하게 하세요. 기능 사용법이 궁금할 때,
요금과 플랜 상담이 필요할 때, 오류나 불편사항을 전달하고 싶을 때 채널톡 하나로
편하게 남겨주세요. (주)비큐AI 서울특별시 중구 퇴계로 385 준타워 9층
</td></tr></table></body></html>`;

/** 완전한 산출물 세트를 가진 잡을 만든다. */
async function fullJob(verifyJson: string | null = PASS_JSON) {
  const job = await createJob("https://www.figma.com/design/abc/", "mock");
  const base = workDir(job.id);
  const out = outputDir(job.id);
  await mkdir(path.join(out, "images"), { recursive: true });
  await writeFile(path.join(out, "edm_figma.html"), SAMPLE_HTML);
  await writeFile(path.join(out, "edm_responsive.html"), SAMPLE_HTML);
  await writeFile(path.join(out, "images", "logo.png"), "png");
  for (const f of ["figma_full.png", "my_full.png", "side_by_side.png", "diff_heat.png"]) {
    await writeFile(path.join(base, f), "png");
  }
  if (verifyJson !== null) await writeFile(path.join(base, "verify.json"), verifyJson);
  return job;
}

describe("checkAcceptance", () => {
  it("passes a complete deliverable set", async () => {
    const job = await fullJob();
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(true);
    expect(a.failures).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(a.verify).toEqual({ result: "PASS", overall: 97.3, heightDelta: 2 });
  });

  it("fails when final HTML files are missing", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("_figma.html");
    expect(a.failures.join(" ")).toContain("_responsive.html");
  });

  it("finds HTML deliverables in nested output folders", async () => {
    const job = await fullJob();
    const nested = path.join(outputDir(job.id), "hosted");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "edm_hosted.html"), "<html/>");
    expect((await checkAcceptance(job.id)).ok).toBe(true);
  });

  it("fails when verify evidence images are missing", async () => {
    const job = await fullJob();
    await rm(path.join(workDir(job.id), "my_full.png"));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("my_full.png");
  });

  it("fails when verify.json is absent or malformed", async () => {
    const missing = await fullJob(null);
    expect((await checkAcceptance(missing.id)).failures.join(" ")).toContain("verify.json");

    const malformed = await fullJob("{not json");
    const a = await checkAcceptance(malformed.id);
    expect(a.ok).toBe(false);
    expect(a.verify).toBeNull();
  });

  it("fails when the verify result is FAIL", async () => {
    const job = await fullJob(JSON.stringify({ result: "FAIL", overall: 88.2, height_delta: 40 }));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("FAIL");
    expect(a.verify).toEqual({ result: "FAIL", overall: 88.2, heightDelta: 40 });
  });

  it("downgrades verify FAIL to a warning when requireVerifyPass is false (edit jobs)", async () => {
    const job = await fullJob(JSON.stringify({ result: "FAIL", overall: 88.2, height_delta: 40 }));
    const a = await checkAcceptance(job.id, { requireVerifyPass: false });
    expect(a.ok).toBe(true);
    expect(a.warnings.join(" ")).toContain("의도한 수정");
    expect(a.verify?.result).toBe("FAIL");
  });

  it("rejects a verify.json left behind by an earlier attempt", async () => {
    const job = await fullJob();
    // edit 잡은 원본 workDir을 복사해 오고 resume은 같은 workDir을 재사용한다 —
    // 이전 실행의 PASS가 이번 실행의 증거로 둔갑하면 안 된다.
    const a = await checkAcceptance(job.id, { freshSince: Date.now() + 1000 });
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("갱신되지");
  });

  it("accepts a verify.json written during this attempt", async () => {
    const job = await fullJob();
    const a = await checkAcceptance(job.id, { freshSince: Date.now() - 60_000 });
    expect(a.ok).toBe(true);
  });

  it("treats an empty evidence file as missing", async () => {
    const job = await fullJob();
    // compare.py가 쓰다 죽으면 0바이트 파일이 남는다 — existsSync는 통과시킨다.
    await writeFile(path.join(workDir(job.id), "my_full.png"), "");
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("my_full.png");
  });

  it("rejects the whole-email-as-one-image shortcut", async () => {
    const job = await fullJob();
    // 실측 재현: codex가 이메일 전체를 스크린샷 1장 + 20자 텍스트로 만들어
    // 픽셀 검증 99.97%로 통과했다 — 게이트가 라이브 텍스트 최소량으로 잡는다.
    const oneImage = `<html><body><style>.x{color:red}</style>
      <table><tr><td><img src="images/whole.png" alt="뉴스레터 전체 이미지"></td></tr></table>
      <!-- baked screenshot --></body></html>`;
    await writeFile(path.join(outputDir(job.id), "edm_responsive.html"), oneImage);
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("라이브 텍스트");
    expect(a.failures.join(" ")).toContain("edm_responsive.html");
  });

  it("does not count style blocks, tags, or alt text as live text", () => {
    const html = `<style>${"a".repeat(500)}</style><img alt="${"b".repeat(500)}"><p>실제텍스트</p>`;
    expect(liveTextChars(html)).toBe(5);
  });

  it("does not count hidden-element text (the sr-only stuffing tactic)", () => {
    // 실측 재현 2탄: codex가 1px/clip 숨김 div에 전체 카피를 넣어 글자 수만 채웠다.
    const srOnly =
      `<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">` +
      `${"가".repeat(400)}<div style="color:#000">중첩도 함께 제거</div></div>` +
      `<div style="display:none;">${"나".repeat(200)}</div>` +
      `<td style="mso-hide:all">${"다".repeat(200)}</td>` +
      `<p>보이는것만</p>`;
    expect(liveTextChars(srOnly)).toBe(5);
    // opacity:0.9·font-size:14px 같은 정상 스타일은 숨김으로 오인하지 않는다.
    expect(liveTextChars(`<p style="opacity:0.9;font-size:14px;">정상텍스트다섯</p>`)).toBe(7);
  });

  it("flags a page-screenshot-like image, not legit section images", async () => {
    const { findScreenshotLikeImages } = await import("./acceptance");
    const shot = `<img src="images/whole.png" width="700" height="2207" style="display:block">`;
    const hero = `<img src="images/hero.png" width="700" height="385">`;
    const emoji = `<img src="images/e.png" width="100" height="200">`; // 좁은 이미지는 제외
    const styleOnly = `<img src="images/s.png" style="width:700px;height:2100px;line-height:0">`;
    expect(findScreenshotLikeImages(shot + hero + emoji)).toEqual(["images/whole.png"]);
    expect(findScreenshotLikeImages(styleOnly)).toEqual(["images/s.png"]);
    expect(findScreenshotLikeImages(hero + emoji)).toEqual([]);
  });

  it("only warns when images/ is empty", async () => {
    const job = await fullJob();
    await rm(path.join(outputDir(job.id), "images"), { recursive: true });
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(true);
    expect(a.warnings.join(" ")).toContain("images");
  });
});

describe("readVerifySummary", () => {
  it("returns null for unknown result values", async () => {
    const job = await fullJob(JSON.stringify({ result: "MAYBE" }));
    expect(await readVerifySummary(job.id)).toBeNull();
  });
});
