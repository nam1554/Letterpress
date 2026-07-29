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

/** 크기만 읽히면 되는 최소 PNG (시그니처 + IHDR). */
function fakePng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x49484452, 12);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

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
      `<table><tr><td style="mso-hide:all">${"다".repeat(200)}</td></tr></table>` +
      `<p>보이는것만</p>`;
    expect(liveTextChars(srOnly)).toBe(5);
    // opacity:0.9·font-size:14px 같은 정상 스타일은 숨김으로 오인하지 않는다.
    expect(liveTextChars(`<p style="opacity:0.9;font-size:14px;">정상텍스트다섯</p>`)).toBe(7);
  });

  it("does not count class-hidden or transparent text (round-3 tactic)", () => {
    // 실측 재현 3탄: 숨김을 인라인이 아니라 <style> 클래스로 옮기고
    // color:transparent를 썼다 — 클래스 규칙까지 해석해야 잡힌다.
    const html =
      `<style>.email-copy{position:absolute;left:0;top:0;color:transparent;width:1px;overflow:visible}</style>` +
      `<table><tr><td class="email-copy">${"가".repeat(400)}</td></tr></table><p>보이는것만</p>`;
    expect(liveTextChars(html)).toBe(5);
  });

  it("does not read ordinary declarations as hidden (property-name boundaries)", () => {
    // 예전 구현은 값만 훑는 하나의 정규식이라 `background-color:transparent`,
    // `border-color:transparent`, `margin-left:-100px`를 숨김으로 읽고 본문을
    // 통째로 지웠다 — 표 기반 이메일에서 흔한 선언이라 정상 빌드가 실패했다.
    const body = "가".repeat(300);
    for (const style of [
      "background-color:transparent;padding:1px",
      "border-color:transparent",
      "margin-left:-100px",
      "left:-9999px", // position이 없으면 화면 밖으로 나가지 않는다
      "height:1px;background:#eee;width:100%", // 1px 구분선
      "font-size:14px;color:#333",
    ]) {
      expect(liveTextChars(`<table><tr><td style="${style}">${body}</td></tr></table>`)).toBe(300);
    }
    // 진짜 숨김은 여전히 잡는다.
    for (const style of [
      "display:none",
      "color:transparent",
      "font-size:0",
      "position:absolute;left:-9999px",
      "width:1px;height:1px;overflow:hidden",
    ]) {
      expect(liveTextChars(`<table><tr><td style="${style}">${body}</td></tr></table>`)).toBe(0);
    }
  });

  it("reads hidden classes inside @media, but not mobile-only rules", () => {
    const copy = "가".repeat(400);
    // 우회 4탄: 숨김 규칙을 @media로 감싸면 예전 평면 정규식은 선택자를
    // `@media all`로 읽어 클래스를 놓쳤다.
    const wrapped =
      `<style>@media all{.email-copy{color:transparent}.pad{padding:0}}</style>` +
      `<table><tr><td class="email-copy">${copy}</td></tr></table><p>보이는것만</p>`;
    expect(liveTextChars(wrapped)).toBe(5);

    // 반대로 모바일 전용 규칙은 데스크톱 렌더를 숨기지 않는다 — 이걸 숨김으로
    // 읽으면 정상 반응형 산출물의 본문이 사라져 게이트가 잘못 실패한다.
    const responsive =
      `<style>@media only screen and (max-width:600px){.desktop-only{display:none}}</style>` +
      `<table><tr><td class="desktop-only">${copy}</td></tr></table>`;
    expect(liveTextChars(responsive)).toBe(400);

    // 나중 규칙이 다시 보이게 하면 취소된다 (캐스케이드).
    const unhidden =
      `<style>.swap{display:none} @media all{.swap{display:block}}</style>` +
      `<table><tr><td class="swap">${copy}</td></tr></table>`;
    expect(liveTextChars(unhidden)).toBe(400);

    // 자손 선택자는 조상 조건을 실제로 따진다 — 파서가 선택자를 매칭하므로
    // `.wrap .sr-only`는 `.wrap` 안의 것만 숨기고 `.wrap` 자체는 남는다.
    const descendant =
      `<style>.wrap .sr-only{display:none}</style>` +
      `<div class="wrap">${copy}<span class="sr-only">숨김</span></div>`;
    expect(liveTextChars(descendant)).toBe(400);
    // 조상 조건이 문서에 없으면(다크모드 전용 `[data-ogsc]`) 숨겨지지 않는다.
    const darkMode =
      `<style>[data-ogsc] .cta{display:none}</style><a class="cta">${copy}</a>`;
    expect(liveTextChars(darkMode)).toBe(400);
    // 태그로 한정한 무조건 규칙은 그대로 숨김이다.
    const tagQualified =
      `<style>td.copy{display:none}</style>` +
      `<table><tr><td class="copy">${copy}</td></tr></table>`;
    expect(liveTextChars(tagQualified)).toBe(0);
  });

  it("keeps text under a font-size:0 wrapper that its children override", () => {
    // `font-size:0;line-height:0`은 이미지 사이 여백을 없애는 관용구다(레퍼런스
    // 발송본에 실재). 상속 속성이라 자손이 다시 지정하면 그 글자는 보인다 —
    // 감싸기만 했다고 본문을 통째로 지우면 정상 빌드가 게이트에서 죽는다.
    const copy = "보이는본문".repeat(32); // 160자
    const wrapped =
      `<table style="font-size:0;line-height:0"><tr>` +
      `<td style="font-size:16px">${copy}</td></tr></table>`;
    expect(liveTextChars(wrapped)).toBe(160);
    // 클래스로 되돌린 경우도 같다.
    const viaClass =
      `<style>.body-copy{font-size:16px}</style>` +
      `<div style="font-size:0"><p class="body-copy">${copy}</p></div>`;
    expect(liveTextChars(viaClass)).toBe(160);
    // 되돌리지 않은 글자는 여전히 세지 않는다.
    expect(liveTextChars(`<div style="font-size:0">${copy}</div>`)).toBe(0);
  });

  it("does not let an unrelated later rule cancel a hide", () => {
    const copy = "가".repeat(400);
    // `.copy{display:none}` 뒤의 `.copy{color:#333}`는 display를 되돌리지 않는다.
    const unrelated =
      `<style>.copy{display:none}.copy{color:#333}</style><div class="copy">${copy}</div>`;
    expect(liveTextChars(unrelated)).toBe(0);
    // 같은 속성을 되돌린 규칙만 해제한다.
    const same =
      `<style>.copy{display:none}.copy{display:block}</style><div class="copy">${copy}</div>`;
    expect(liveTextChars(same)).toBe(400);
  });

  it("sees hide rules wrapped in non-width media queries", () => {
    const copy = "가".repeat(400);
    // `(-webkit-min-device-pixel-ratio:0)`는 데스크톱 크롬에서 그대로 적용되는
    // 관용 해킹이다 — 폭 조건이 아니면 질의를 따지지 않는다.
    for (const q of [
      "@media only screen and (-webkit-min-device-pixel-ratio:0)",
      "@media screen and (min-resolution:1dppx)",
      "@media all and (min-width:1px)",
    ]) {
      const html = `<style>${q}{.c{color:transparent}}</style><div class="c">${copy}</div>`;
      expect(liveTextChars(html)).toBe(0);
    }
    // 모바일 전용 규칙은 여전히 데스크톱 렌더를 숨기지 않는다.
    const mobile =
      `<style>@media screen and (max-width:600px){.c{display:none}}</style>` +
      `<div class="c">${copy}</div>`;
    expect(liveTextChars(mobile)).toBe(400);
  });

  it("1px 상자 숨김도 뒤 선언으로 되돌릴 수 있다", () => {
    const copy = "가".repeat(400);
    // 유틸리티 클래스를 인라인으로 덮어쓴 정상 마크업 — 크롬은 600px로 렌더한다.
    const overridden =
      `<style>.tiny{width:1px;height:1px;overflow:hidden}</style>` +
      `<div class="tiny" style="width:600px;height:auto;overflow:visible">${copy}</div>`;
    expect(liveTextChars(overridden)).toBe(400);
    // 덮어쓰지 않으면 여전히 숨김이다.
    const hidden =
      `<style>.tiny{width:1px;height:1px;overflow:hidden}</style>` +
      `<div class="tiny">${copy}</div>`;
    expect(liveTextChars(hidden)).toBe(0);
  });

  it("prefers-color-scheme 조건이 같은 질의의 폭 조건을 가리지 않는다", () => {
    const copy = "가".repeat(400);
    // 라이트 모드 + 모바일 전용 규칙 — 데스크톱 검증 렌더에는 적용되지 않는다.
    const html =
      `<style>@media (prefers-color-scheme: light) and (max-width: 600px){.copy{display:none}}</style>` +
      `<div class="copy">${copy}</div>`;
    expect(liveTextChars(html)).toBe(400);
    // 다크 전용은 여전히 적용 안 함, 라이트+데스크톱 폭은 적용.
    const applies =
      `<style>@media (prefers-color-scheme: light) and (min-width: 600px){.copy{display:none}}</style>` +
      `<div class="copy">${copy}</div>`;
    expect(liveTextChars(applies)).toBe(0);
  });

  it("resolves CSS the way the verified render does", () => {
    const copy = "가".repeat(400);
    // 규칙 순서: 뒤 규칙이 이긴다. 다른 클래스에 걸린 규칙이라도 마찬가지다.
    const cascade =
      `<style>.b{color:#333}.a{display:none}.b{display:block}</style>` +
      `<div class="a b">${copy}</div>`;
    expect(liveTextChars(cascade)).toBe(400);
    // 조상 조건이 실제로 있으면 숨김이다 (`.wrap .copy`).
    const scoped =
      `<style>.wrap .copy{display:none}</style>` +
      `<div class="wrap"><div class="copy">${copy}</div></div>`;
    expect(liveTextChars(scoped)).toBe(0);
    // 다크모드 전용 규칙은 라이트로 렌더되는 검증 화면에 적용되지 않는다.
    const dark =
      `<style>@media (prefers-color-scheme: dark){.copy{display:none}}</style>` +
      `<div class="copy">${copy}</div>`;
    expect(liveTextChars(dark)).toBe(400);
    // 높이 0으로 잘린 상자는 폭 선언이 없어도 숨김이다.
    expect(liveTextChars(`<div style="height:0;overflow:hidden">${copy}</div>`)).toBe(0);
  });

  it("measures image display size like the browser (max-width, cascade, %)", async () => {
    const { fullWidthImageAspectSum, findScreenshotLikeImages } = await import("./acceptance");
    const sizes = () => ({ w: 600, h: 1400 });
    // `width:100%;max-width:300px`는 300px로 렌더된다 — 상한을 무시하면 2단
    // 칼럼 이미지가 전폭 아트로 오인돼 정상 빌드가 거부된다.
    const column = `<img src="a.png" style="width:100%;max-width:300px">`;
    expect(findScreenshotLikeImages(column, sizes)).toEqual([]);
    expect(fullWidthImageAspectSum(column, sizes)).toBe(0);
    // 폭 클래스가 여럿이면 나중 규칙이 이긴다 — 앞 클래스를 미끼로 좁은 폭을
    // 심어 검사를 끌 수 없다.
    const decoy =
      `<style>.pad{width:100px}.hero{width:700px}</style>` +
      `<img class="pad hero" src="a.png">`;
    expect(findScreenshotLikeImages(decoy, () => ({ w: 700, h: 2000 }))).toEqual(["a.png"]);
    // %는 본문 폭(700) 기준이다 — 레퍼런스 PNG를 2×로 뽑아 기준을 흔들 수 없다.
    const pct = `<img src="a.png" width="100%">`;
    expect(findScreenshotLikeImages(pct, () => ({ w: 1400, h: 4000 }))).toEqual(["a.png"]);
    // 폭을 아무데서도 지정하지 않으면 브라우저는 실측 크기로 렌더하되 담고 있는
    // 칸을 넘지 못한다 — 담는 칸 기준으로 판정한다.
    const bare = `<img src="a.png" style="display:block;max-width:100%">`;
    // 본문 폭 안이면 600px로 렌더 → 세로비 2.33의 큰 이미지로 잡힌다
    // (600px로 구워낸 통짜 캡처가 여기로 빠져나갔었다).
    expect(findScreenshotLikeImages(bare, sizes)).toEqual(["a.png"]);
    // 같은 파일이라도 330px 칸 안이면 330px로 줄어든다 → 전폭 아트가 아니다.
    const inCell = `<table><tr><td width="330">${bare}</td></tr></table>`;
    expect(findScreenshotLikeImages(inCell, sizes)).toEqual([]);
    expect(fullWidthImageAspectSum(inCell, sizes)).toBe(0);
  });

  it("담는 칸 기준으로 폭을 잰다 (2단 칼럼 오탐 · 통짜 캡처 미탐)", async () => {
    const { fullWidthImageAspectSum, findScreenshotLikeImages } = await import("./acceptance");
    // 2단 칼럼: 330px 칸의 width="100%" 이미지를 700px로 읽으면 커버리지가
    // 부풀어 정상 빌드가 "슬라이스"로 거부된다.
    const grid =
      `<table><tr>` +
      `<td width="330"><img src="p1.png" width="100%" style="height:auto"></td>` +
      `<td width="330"><img src="p2.png" width="100%" style="height:auto"></td>` +
      `</tr></table>`;
    expect(fullWidthImageAspectSum(grid, () => ({ w: 330, h: 330 }))).toBe(0);
    // 반대로 본문 폭 칸의 width="100%"는 전폭 아트가 맞다.
    const full = `<table><tr><td width="700"><img src="w.png" width="100%"></td></tr></table>`;
    expect(findScreenshotLikeImages(full, () => ({ w: 700, h: 2200 }))).toEqual(["w.png"]);
  });

  it("style의 비-길이 값이 width 속성을 가리지 않는다", async () => {
    const { findScreenshotLikeImages } = await import("./acceptance");
    // `width:auto`가 속성을 가리면 폭을 모르는 이미지가 되어 검사가 꺼진다 —
    // CDN에 올린 통짜 캡처(실측 불가)가 그대로 통과했다.
    const cheat = `<img src="https://cdn.example.com/whole.png" width="700" height="2200" style="width:auto">`;
    expect(findScreenshotLikeImages(cheat)).toEqual(["https://cdn.example.com/whole.png"]);
  });

  it("does not let an Outlook-only or shrink-wrapped wrapper hide an image", async () => {
    const { findScreenshotLikeImages } = await import("./acceptance");
    const shot = `<img src="images/whole.png" width="700" height="2200">`;
    // 크롬 렌더(픽셀 검증이 보는 화면)에는 그대로 보이는 감싸기들 —
    // 이걸로 이미지를 검사에서 숨길 수 있으면 통짜 스크린샷이 통과한다.
    for (const wrapper of [
      `<div style="mso-hide:all">${shot}</div>`, // Outlook 전용
      `<td style="width:1px;height:1px">${shot}</td>`, // td는 늘어난다
      `<div style="clip:rect(0,0,0,0)">${shot}</div>`, // position 없이는 무효
    ]) {
      expect(findScreenshotLikeImages(wrapper)).toEqual(["images/whole.png"]);
    }
    // 진짜로 안 보이는 감싸기는 여전히 제외된다.
    for (const wrapper of [
      `<div style="display:none">${shot}</div>`,
      `<div style="width:1px;height:1px;overflow:hidden">${shot}</div>`,
    ]) {
      expect(findScreenshotLikeImages(wrapper)).toEqual([]);
    }
  });

  it("keeps the rest of the document when a hidden tag has no closing tag", () => {
    const body = "보이는본문".repeat(40); // 200자
    // 예전 구현은 </hr>를 못 찾으면 문서 끝까지 버렸다 — 뒤의 본문이 전부
    // 사라져 정상 산출물이 "통짜 이미지"로 몰렸다.
    expect(liveTextChars(`<hr style="display:none"><p>${body}</p>`)).toBe(200);
    expect(liveTextChars(`<input type="hidden" style="display:none"><p>${body}</p>`)).toBe(200);
    expect(liveTextChars(`<p style="display:none">닫히지 않은 스페이서<p>${body}</p>`)).toBe(200);
    // 반대로 자동으로 닫히지 않는 요소가 열린 채로 끝나면 브라우저는 그 뒤를
    // 전부 그 요소 안으로 넣는다 — 숨김 텍스트를 채워 넣는 통로가 되면 안 된다.
    expect(liveTextChars(`<p>짧은</p><div style="display:none">${body}`)).toBe(2);
  });

  it("sizes height-less full-width images from the image file itself", async () => {
    const { fullWidthImageAspectSum, findScreenshotLikeImages } = await import("./acceptance");
    // 실전 마크업: 전폭 이미지는 `width="700" height:auto`라 height 속성이 없다.
    const tag = `<img src="images/whole.png" width="700" style="max-width:100%;height:auto">`;
    // 파일 크기를 모르면 (예전 구현) 세로비를 몰라 두 검사가 조용히 통과한다.
    expect(fullWidthImageAspectSum(tag)).toBe(0);
    expect(findScreenshotLikeImages(tag)).toEqual([]);
    // 실측(2× 내보내기여도 비율은 같다)을 주면 잡힌다.
    const ctx = () => ({ w: 1400, h: 4414 });
    expect(fullWidthImageAspectSum(tag, ctx)).toBeCloseTo(4414 / 1400, 5);
    expect(findScreenshotLikeImages(tag, ctx)).toEqual(["images/whole.png"]);
    // 폭이 %로만 주어진 이미지도 본문 폭으로 환산해 판정한다.
    const pct = `<img src="images/whole.png" width="100%">`;
    expect(findScreenshotLikeImages(pct, ctx)).toEqual(["images/whole.png"]);
    // height="0"·"1"로 검사를 끌 수 없다 — 브라우저는 style의 height:auto를 따른다.
    for (const h of ["0", "1"]) {
      const cheat = `<img src="images/whole.png" width="700" height="${h}" style="height:auto">`;
      expect(findScreenshotLikeImages(cheat, ctx)).toEqual(["images/whole.png"]);
    }
  });

  it("does not read a 2x export's intrinsic size as its display width", async () => {
    const { fullWidthImageAspectSum, findScreenshotLikeImages } = await import("./acceptance");
    // 300×700 슬롯에 들어가는 2× 내보내기(600×1400). 실측 폭을 표시 폭으로 쓰면
    // 전폭 이미지로 오인해 정상 빌드를 "스크린샷/슬라이스"로 거부한다.
    const ctx = () => ({ w: 600, h: 1400 });
    for (const tag of [
      `<style>.mock{width:300px}</style><img class="mock" src="images/phone.png">`,
      `<img src="images/phone.png" width="300">`,
      `<img src="images/phone.png" style="width:300px">`,
    ]) {
      expect(findScreenshotLikeImages(tag, ctx)).toEqual([]);
      expect(fullWidthImageAspectSum(tag, ctx)).toBe(0);
    }
  });

  it("rejects a height-less sliced build end to end", async () => {
    const job = await fullJob();
    await writeFile(path.join(workDir(job.id), "figma_full.png"), fakePng(700, 2207));
    const slices = ["header", "hero", "intro", "cards", "banner", "closing", "footer"];
    const heights = [85, 385, 240, 723, 234, 311, 229];
    await Promise.all(
      slices.map((name, i) =>
        writeFile(
          path.join(outputDir(job.id), "images", `${name}.png`),
          fakePng(1400, heights[i] * 2), // 레티나 2× 내보내기
        ),
      ),
    );
    await writeFile(
      path.join(outputDir(job.id), "edm_responsive.html"),
      `<html><body><p>${"보이는본문텍스트".repeat(20)}</p>` +
        slices
          .map((n) => `<img src="images/${n}.png" width="700" style="height:auto">`)
          .join("") +
        `</body></html>`,
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("슬라이스");
  });

  it("measures base64 images in a self-contained deliverable", async () => {
    const job = await fullJob();
    await writeFile(path.join(workDir(job.id), "figma_full.png"), fakePng(700, 2207));
    const whole = `data:image/png;base64,${fakePng(700, 2207).toString("base64")}`;
    await writeFile(
      path.join(outputDir(job.id), "edm_responsive.html"),
      `<html><body><p>${"보이는본문텍스트".repeat(20)}</p>` +
        `<img src="${whole}" width="700" style="height:auto"></body></html>`,
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("스크린샷");

    // ICC 프로파일(APP2 20KB)이 앞에 붙은 JPEG — 앞부분만 디코드하면 프레임
    // 헤더에 닿지 못해 크기를 못 재고 두 이미지 검사가 통째로 꺼진다.
    const icc = Buffer.alloc(2 + 20_000);
    icc.writeUInt16BE(0xffe2, 0);
    icc.writeUInt16BE(20_000, 2);
    const sof = Buffer.alloc(2 + 17);
    sof.writeUInt16BE(0xffc0, 0);
    sof.writeUInt16BE(17, 2);
    sof.writeUInt16BE(2207, 5);
    sof.writeUInt16BE(700, 7);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), icc, sof]);
    await writeFile(
      path.join(outputDir(job.id), "edm_responsive.html"),
      `<html><body><p>${"보이는본문텍스트".repeat(20)}</p>` +
        `<img src="data:image/jpeg;base64,${jpg.toString("base64")}" width="700" ` +
        `style="height:auto"></body></html>`,
    );
    expect((await checkAcceptance(job.id)).failures.join(" ")).toContain("스크린샷");
  });

  it("counts only rendered images — hidden variants and font-size:0 cells", async () => {
    const job = await fullJob();
    await writeFile(path.join(workDir(job.id), "figma_full.png"), fakePng(700, 2207));
    await writeFile(path.join(outputDir(job.id), "images", "hero.png"), fakePng(1400, 770));
    // 반응형 산출물은 같은 아트를 데스크톱/모바일 두 벌로 싣는다 — 숨긴 쪽까지
    // 세면 커버리지가 두 배가 되어 정상 빌드가 "슬라이스"로 거부된다.
    // 이미지 간격 제거용 `font-size:0` 셀은 이미지 검사에서 살아 있어야 한다
    // (텍스트 검사에서만 숨김으로 친다).
    const img = `<img src="images/hero.png" width="700" style="height:auto">`;
    await writeFile(
      path.join(outputDir(job.id), "edm_responsive.html"),
      `<html><body><style>@media only screen and (max-width:600px){.desktop{display:none}}</style>` +
        `<p>${"보이는본문텍스트".repeat(20)}</p>` +
        `<td style="font-size:0;line-height:0">${img}</td>` +
        `<td class="mobile" style="display:none">${img}</td>` +
        `</body></html>`,
    );
    const a = await checkAcceptance(job.id);
    expect(a.failures.join(" ")).not.toContain("슬라이스");
    expect(a.ok).toBe(true);
  });

  it("rejects a sliced-screenshot build via full-width image coverage", async () => {
    const { fullWidthImageAspectSum } = await import("./acceptance");
    const slice = (name: string, h: number) =>
      `<img src="images/${name}.png" width="700" height="${h}">`;
    // codex 3차 실측: 7조각 슬라이스 = 커버리지 100%
    const sliced =
      slice("header", 85) + slice("hero", 385) + slice("intro", 240) + slice("cards", 723) +
      slice("banner", 234) + slice("closing", 311) + slice("footer", 229);
    // 정직한 빌드: 히어로 + CTA만 이미지 = 28%
    const honest = slice("hero", 385) + slice("cta", 234);
    const canvasAspect = 2207 / 700;
    expect(fullWidthImageAspectSum(sliced) / canvasAspect).toBeGreaterThan(0.7);
    expect(fullWidthImageAspectSum(honest) / canvasAspect).toBeLessThan(0.7);

    // 게이트 통합: 진짜 PNG 헤더의 figma_full.png가 있으면 커버리지로 거부한다.
    const job = await fullJob();
    await writeFile(path.join(workDir(job.id), "figma_full.png"), fakePng(700, 2207));
    await writeFile(
      path.join(outputDir(job.id), "edm_responsive.html"),
      `<html><body><p>${"보이는본문텍스트".repeat(20)}</p>${sliced}</body></html>`,
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("슬라이스");
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

  it("passes a realistic responsive build with every risky idiom at once", async () => {
    // 실전 관용구를 한 산출물에 모아 오탐을 막는 회귀 테스트 — 반응형 이중
    // 아트(모바일 쪽 display:none), 이미지 여백 제거용 font-size:0 셀,
    // `width:100%;max-width:300px` 2단 칼럼, height 속성 없는 전폭 이미지.
    const job = await fullJob();
    const out = outputDir(job.id);
    await writeFile(path.join(workDir(job.id), "figma_full.png"), fakePng(700, 2207));
    await writeFile(path.join(out, "images", "hero.png"), fakePng(1400, 770));
    await writeFile(path.join(out, "images", "card.png"), fakePng(600, 1400));
    const html = `<html><head><style>
      .mobile{display:none}
      @media only screen and (max-width:600px){.desktop{display:none}.mobile{display:block}}
      .card{width:100%;max-width:300px}
      </style></head><body><table>
      <tr><td style="font-size:0;line-height:0"><img class="desktop" src="images/hero.png" width="700" style="height:auto"></td></tr>
      <tr><td class="mobile"><img src="images/hero.png" width="100%" style="height:auto"></td></tr>
      <tr><td><p>${"보이는본문텍스트".repeat(20)}</p></td></tr>
      <tr><td><img class="card" src="images/card.png" style="height:auto"></td></tr>
      </table></body></html>`;
    await writeFile(path.join(out, "edm_figma.html"), html);
    await writeFile(path.join(out, "edm_responsive.html"), html);
    const a = await checkAcceptance(job.id);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
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
