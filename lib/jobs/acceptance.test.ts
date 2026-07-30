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

import {
  checkAcceptance,
  findScreenshotLikeImages,
  fullWidthImageAspectSum,
  readVerifySummary,
} from "./acceptance";
import { measureHtmlFiles } from "./measure";
import { realPng } from "./png-fixture";
import { createJob, outputDir, workDir } from "./store";

const PASS_JSON = JSON.stringify({
  result: "PASS",
  overall: 97.3,
  height_delta: 2,
  bands: [{ name: "header", sim: 99.1, shift: 0, ok: true }],
});

// 게이트의 라이브 텍스트 최소량(100자)을 넘는 정상 산출물 본문.
const BODY_COPY = `아이서퍼 고객님, 이제 문의는 채널톡으로 편하게 하세요. 기능 사용법이 궁금할 때,
요금과 플랜 상담이 필요할 때, 오류나 불편사항을 전달하고 싶을 때 채널톡 하나로
편하게 남겨주세요. (주)비큐AI 서울특별시 중구 퇴계로 385 준타워 9층`;
const SAMPLE_HTML = `<html><body><table><tr><td>${BODY_COPY}</td></tr></table></body></html>`;

/** 완전한 산출물 세트를 가진 잡을 만든다. */
async function fullJob(verifyJson: string | null = PASS_JSON) {
  const job = await createJob("https://www.figma.com/design/abc/", "mock");
  const base = workDir(job.id);
  const out = outputDir(job.id);
  await mkdir(path.join(out, "images"), { recursive: true });
  await writeFile(path.join(out, "edm_figma.html"), SAMPLE_HTML);
  await writeFile(path.join(out, "edm_responsive.html"), SAMPLE_HTML);
  await writeFile(path.join(out, "images", "logo.png"), realPng(150, 27));
  for (const f of ["my_full.png", "side_by_side.png", "diff_heat.png"]) {
    await writeFile(path.join(base, f), realPng(10, 10));
  }
  // 커버리지 검사의 기준 캔버스 (700×2207 = 실측 레퍼런스 비율).
  await writeFile(path.join(base, "figma_full.png"), realPng(700, 2207));
  if (verifyJson !== null) await writeFile(path.join(base, "verify.json"), verifyJson);
  return job;
}

/**
 * 여러 HTML 조각을 실제 브라우저로 재서 "보이는 글자 수"만 뽑는다.
 * 브라우저 실행은 한 번이라 케이스를 묶어 쓰는 것이 빠르다.
 */
async function visibleChars(cases: Record<string, string>): Promise<Record<string, number>> {
  const names = Object.keys(cases);
  const files = await Promise.all(
    names.map(async (name, i) => {
      const file = path.join(dir, `probe-${i}-${name}.html`);
      await writeFile(file, `<html><body style="margin:0">${cases[name]}</body></html>`);
      return file;
    }),
  );
  const measured = await measureHtmlFiles(files);
  const out: Record<string, number> = {};
  names.forEach((name, i) => {
    const m = measured[i];
    expect(m.ok, `${name}: 렌더 실패`).toBe(true);
    out[name] = m.ok ? m.textChars : -1;
  });
  return out;
}

describe("checkAcceptance — 산출물 계약", () => {
  it("완전한 산출물 세트는 통과한다", async () => {
    const job = await fullJob();
    const a = await checkAcceptance(job.id);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.verify).toEqual({ result: "PASS", overall: 97.3, heightDelta: 2 });
  }, 30_000);

  it("최종 HTML이 없으면 실패한다", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("_figma.html");
    expect(a.failures.join(" ")).toContain("_responsive.html");
  });

  it("하위 폴더의 HTML도 산출물로 인정한다", async () => {
    const job = await fullJob();
    const nested = path.join(outputDir(job.id), "hosted");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "edm_hosted.html"), "<html/>");
    expect((await checkAcceptance(job.id)).ok).toBe(true);
  }, 30_000);

  it("검증 증거물이 없으면 실패한다", async () => {
    const job = await fullJob();
    await rm(path.join(workDir(job.id), "my_full.png"));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("my_full.png");
  }, 30_000);

  it("0바이트 증거물은 없는 것으로 친다", async () => {
    const job = await fullJob();
    // compare.py가 쓰다 죽으면 0바이트 파일이 남는다 — existsSync는 통과시킨다.
    await writeFile(path.join(workDir(job.id), "my_full.png"), "");
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("my_full.png");
  }, 30_000);

  it("verify.json이 없거나 깨졌으면 실패한다", async () => {
    const missing = await fullJob(null);
    expect((await checkAcceptance(missing.id)).failures.join(" ")).toContain("verify.json");
    const malformed = await fullJob("{not json");
    const a = await checkAcceptance(malformed.id);
    expect(a.ok).toBe(false);
    expect(a.verify).toBeNull();
  }, 60_000);

  it("verify 결과가 FAIL이면 실패한다", async () => {
    const job = await fullJob(JSON.stringify({ result: "FAIL", overall: 88.2, height_delta: 40 }));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("FAIL");
  }, 30_000);

  it("부분 수정(edit) 잡은 verify FAIL을 경고로 강등한다", async () => {
    const job = await fullJob(JSON.stringify({ result: "FAIL", overall: 88.2, height_delta: 40 }));
    const a = await checkAcceptance(job.id, { requireVerifyPass: false });
    expect(a.ok).toBe(true);
    expect(a.warnings.join(" ")).toContain("의도한 수정");
  }, 30_000);

  it("이전 실행이 남긴 verify.json은 증거로 인정하지 않는다", async () => {
    const job = await fullJob();
    // edit 잡은 원본 workDir을 복사해 오고 resume은 같은 workDir을 재사용한다.
    const a = await checkAcceptance(job.id, { freshSince: Date.now() + 1000 });
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("갱신되지");
  }, 30_000);

  it("이번 실행에서 갱신된 verify.json은 인정한다", async () => {
    const job = await fullJob();
    expect((await checkAcceptance(job.id, { freshSince: Date.now() - 60_000 })).ok).toBe(true);
  }, 30_000);

  it("images/가 비어 있으면 경고만 한다", async () => {
    const job = await fullJob();
    await rm(path.join(outputDir(job.id), "images"), { recursive: true });
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(true);
    expect(a.warnings.join(" ")).toContain("images");
  }, 30_000);
});

describe("보이는 텍스트 — 실제 렌더 기준", () => {
  it("숨김 관용구의 텍스트는 세지 않고, 정상 스타일은 오인하지 않는다", async () => {
    const copy = "가".repeat(400);
    const chars = await visibleChars({
      // 실측 재현 2탄: 1px/clip 숨김 div에 카피를 넣어 글자 수만 채웠다.
      srOnly: `<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">${copy}</div><p>보이는것만</p>`,
      displayNone: `<div style="display:none">${copy}</div><p>보이는것만</p>`,
      transparent: `<p style="color:transparent">${copy}</p><p>보이는것만</p>`,
      fontZero: `<p style="font-size:0">${copy}</p><p>보이는것만</p>`,
      offscreen: `<div style="position:absolute;left:-9999px">${copy}</div><p>보이는것만</p>`,
      // 6라운드: 왼쪽만 검사하던 판정의 거울상 — 오른쪽으로 밀어도 안 보인다.
      offscreenRight: `<div style="position:absolute;left:9999px">${copy}</div><p>보이는것만</p>`,
      // 6라운드: 삭제된 휴리스틱이 명시적으로 막던 관용구들이 되살아났었다.
      textIndent: `<div style="text-indent:-9999px">${copy}</div><p>보이는것만</p>`,
      clipPath: `<div style="clip-path:inset(50%)">${copy}</div><p>보이는것만</p>`,
      scaleZero: `<div style="transform:scale(0)">${copy}</div><p>보이는것만</p>`,
      opacityZero: `<div style="opacity:0">${copy}</div><p>보이는것만</p>`,
      // 실측 재현 3탄: 숨김을 <style> 클래스로 옮기고 color:transparent를 썼다.
      classHidden: `<style>.c{position:absolute;left:0;top:0;color:transparent;width:1px;overflow:hidden}</style><table><tr><td class="c">${copy}</td></tr></table><p>보이는것만</p>`,
      // 정상 스타일 — 숨김으로 오인하면 정상 빌드가 죽는다.
      normalStyles: `<p style="opacity:0.9;font-size:14px;background-color:transparent">정상텍스트다섯</p>`,
      blackText: `<p style="color:#000">검은글자다섯</p>`,
      spacerCell: `<table><tr><td style="font-size:0;line-height:0"><span style="font-size:16px">여백셀안의본문</span></td></tr></table>`,
      // 6라운드 오탐: 높이 0 래퍼는 overflow가 visible이면 넘친 글자가 그려진다.
      zeroHeightWrapper: `<div style="height:0">${copy}</div>`,
      // 6라운드 오탐: visibility는 자손이 되돌릴 수 있다 (opacity와 다르다).
      visibleChild: `<div style="visibility:hidden"><p style="visibility:visible">${copy}</p></div>`,
      // 6라운드 오탐: 자리만 잡는 래퍼(플로트 행·오버레이)도 상자가 0이 된다.
      floatRow: `<div><div style="float:left;width:700px">${copy}</div></div>`,
    });
    for (const key of [
      "srOnly",
      "displayNone",
      "transparent",
      "fontZero",
      "offscreen",
      "offscreenRight",
      "textIndent",
      "clipPath",
      "scaleZero",
      "opacityZero",
      "classHidden",
    ]) {
      expect(chars[key], `${key}: 숨김 텍스트가 세어졌다`).toBe(5);
    }
    expect(chars.normalStyles).toBe(7);
    expect(chars.blackText).toBe(6);
    expect(chars.spacerCell).toBe(7);
    for (const key of ["zeroHeightWrapper", "visibleChild", "floatRow"]) {
      expect(chars[key], `${key}: 보이는 텍스트를 숨김으로 오인했다`).toBe(400);
    }
  }, 60_000);

  it("캐스케이드·미디어쿼리·상속을 브라우저가 판정한다", async () => {
    const copy = "가".repeat(400);
    const chars = await visibleChars({
      // 뒤 규칙이 이긴다 (다른 클래스에 걸린 규칙이라도).
      cascade: `<style>.b{color:#333}.a{display:none}.b{display:block}</style><div class="a b">${copy}</div>`,
      // 조상 조건이 실제로 있을 때만 숨긴다.
      scoped: `<style>.wrap .copy{display:none}</style><div class="wrap"><div class="copy">${copy}</div></div>`,
      unscoped: `<style>.wrap .copy{display:none}</style><div class="copy">${copy}</div>`,
      // 모바일 전용 규칙은 데스크톱 렌더에 적용되지 않는다.
      mobileOnly: `<style>@media (max-width:600px){.c{display:none}}</style><div class="c">${copy}</div>`,
      // 라이트+모바일 조건이 함께 있어도 폭 조건이 지배한다.
      lightMobile: `<style>@media (prefers-color-scheme: light) and (max-width:600px){.c{display:none}}</style><div class="c">${copy}</div>`,
      // 6라운드: 색 구성을 고정하지 않으면 OS 테마에 따라 판정이 갈렸다.
      // 다크 전용 숨김은 적용되지 않고(오탐 방지), 라이트 전용 숨김은 적용된다.
      darkOnly: `<style>@media (prefers-color-scheme: dark){.c{display:none}}</style><div class="c">${copy}</div>`,
      lightOnly: `<style>@media (prefers-color-scheme: light){.c{display:none}}</style><div class="c">${copy}</div>`,
      // 감싸기만 한 숨김은 그대로 숨김이다 (우회 차단).
      wrappedAll: `<style>@media all{.c{color:transparent}}</style><div class="c">${copy}</div><p>보이는것만</p>`,
      pixelRatioHack: `<style>@media screen and (-webkit-min-device-pixel-ratio:0){.c{display:none}}</style><div class="c">${copy}</div><p>보이는것만</p>`,
      // 1px 상자를 인라인으로 되돌린 정상 마크업.
      overridden: `<style>.tiny{width:1px;height:1px;overflow:hidden}</style><div class="tiny" style="width:600px;height:auto;overflow:visible">${copy}</div>`,
      // 속성 하나 재선언으로 숨김이 풀리면 안 된다 (5라운드 우회).
      restated: `<style>.tiny{width:1px;height:1px;overflow:hidden}</style><div class="tiny" style="height:1px">${copy}</div><p>보이는것만</p>`,
    });
    expect(chars.cascade).toBe(400);
    expect(chars.scoped).toBe(0);
    expect(chars.unscoped).toBe(400);
    expect(chars.mobileOnly).toBe(400);
    expect(chars.lightMobile).toBe(400);
    expect(chars.darkOnly, "다크 전용 숨김이 라이트 렌더에 적용됐다").toBe(400);
    expect(chars.lightOnly, "라이트로 고정되지 않았다").toBe(0);
    expect(chars.wrappedAll).toBe(5);
    expect(chars.pixelRatioHack).toBe(5);
    expect(chars.overridden).toBe(400);
    expect(chars.restated).toBe(5);
  }, 60_000);

  it("닫히지 않은 마크업도 브라우저와 같게 해석한다", async () => {
    const body = "보이는본문".repeat(40); // 200자
    const chars = await visibleChars({
      voidTag: `<hr style="display:none"><p>${body}</p>`,
      autoClose: `<p style="display:none">닫히지않은스페이서<p>${body}</p>`,
      unclosedDiv: `<p>짧은</p><div style="display:none">${body}`,
      styleAndScript: `<style>${"a".repeat(500)}</style><script>${"b".repeat(500)}</script><p>실제텍스트</p>`,
      altText: `<img alt="${"b".repeat(500)}"><p>실제텍스트</p>`,
    });
    expect(chars.voidTag).toBe(200);
    expect(chars.autoClose).toBe(200);
    // 닫히지 않은 div는 브라우저도 뒤를 그 안으로 넣는다 → 숨김.
    expect(chars.unclosedDiv).toBe(2);
    expect(chars.styleAndScript).toBe(5);
    expect(chars.altText).toBe(5);
  }, 60_000);
});

describe("이미지 검사 — 렌더된 크기로 판정", () => {
  it("스크린샷 의심 판정은 폭 400px·세로비 2 기준이다", () => {
    expect(
      findScreenshotLikeImages([
        { src: "whole.png", width: 700, height: 2207 },
        { src: "hero.png", width: 700, height: 385 },
        { src: "emoji.png", width: 100, height: 200 },
      ]),
    ).toEqual(["whole.png"]);
  });

  it("커버리지는 전폭 이미지의 세로비 합이다", () => {
    const honest = [
      { src: "hero.png", width: 700, height: 385 },
      { src: "cta.png", width: 700, height: 234 },
    ];
    const sliced = [85, 385, 240, 723, 234, 311, 229].map((h, i) => ({
      src: `s${i}.png`,
      width: 700,
      height: h,
    }));
    const canvasAspect = 2207 / 700;
    expect(fullWidthImageAspectSum(honest) / canvasAspect).toBeLessThan(0.7);
    expect(fullWidthImageAspectSum(sliced) / canvasAspect).toBeGreaterThan(0.7);
    // 좁은 이미지는 아무리 많아도 커버리지에 들어가지 않는다.
    expect(fullWidthImageAspectSum([{ src: "c.png", width: 330, height: 990 }])).toBe(0);
  });
});

describe("게이트 통합 — 실전 산출물 형태", () => {
  /** 산출물 HTML과 이미지를 갖춘 잡을 만든다. */
  async function jobWith(html: string, images: Record<string, [number, number]>) {
    const job = await fullJob();
    const out = outputDir(job.id);
    for (const [name, [w, h]] of Object.entries(images)) {
      await writeFile(path.join(out, "images", name), realPng(w, h));
    }
    await writeFile(path.join(out, "edm_figma.html"), html);
    await writeFile(path.join(out, "edm_responsive.html"), html);
    return job;
  }

  it("통짜 이미지 산출물은 거부한다 (숨김 텍스트로 채워도)", async () => {
    // 실측 재현: codex가 이메일 전체를 스크린샷 1장 + 숨김 카피로 통과시켰다.
    const job = await jobWith(
      `<html><body><table><tr><td><img src="images/whole.png" width="700" style="height:auto"></td></tr></table>` +
        `<div style="height:0;overflow:hidden">${BODY_COPY}${BODY_COPY}</div></body></html>`,
      { "whole.png": [1400, 4414] },
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("라이브 텍스트");
    expect(a.failures.join(" ")).toContain("스크린샷");
  }, 30_000);

  it("좁은 칸으로 감싸도 통짜 캡처는 거부한다 (5라운드 우회)", async () => {
    // td width는 표 자동 레이아웃에서 최소값이라 큰 이미지가 칸을 늘린다 —
    // 마크업만 보고 계산하던 구현은 이걸 300px로 읽어 검사를 껐다.
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p>` +
        `<table><tr><td width="300"><img src="images/whole.png"></td></tr></table></body></html>`,
      { "whole.png": [700, 2200] },
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("스크린샷");
  }, 30_000);

  it("슬라이스 산출물은 거부한다 (height 속성 없이도)", async () => {
    const slices = [85, 385, 240, 723, 234, 311, 229];
    const images: Record<string, [number, number]> = {};
    let imgs = "";
    slices.forEach((h, i) => {
      images[`s${i}.png`] = [1400, h * 2]; // 레티나 2× 내보내기
      imgs += `<img src="images/s${i}.png" width="700" style="height:auto">`;
    });
    const job = await jobWith(`<html><body><p>${BODY_COPY}</p>${imgs}</body></html>`, images);
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("슬라이스");
  }, 30_000);

  it("실전 관용구를 모아도 정상 빌드는 통과한다", async () => {
    // 반응형 이중 아트(모바일 display:none) · 여백 제거용 font-size:0 셀 ·
    // 중첩 테이블 2단 칼럼(width="100%") · height 없는 전폭 이미지 ·
    // max-width로 줄인 카드 — 지금까지 오탐이 났던 모든 형태.
    const job = await jobWith(
      `<html><head><style>
        .mobile{display:none}
        @media only screen and (max-width:600px){.desktop{display:none}.mobile{display:block}}
        .card{width:100%;max-width:300px}
       </style></head><body><table width="700">
        <tr><td style="font-size:0;line-height:0"><img class="desktop" src="images/hero.png" width="700" style="height:auto"></td></tr>
        <tr><td class="mobile"><img src="images/hero.png" width="100%" style="height:auto"></td></tr>
        <tr><td><p>${BODY_COPY}</p></td></tr>
        <tr><td width="330"><table width="100%"><tr><td>
          <img class="card" src="images/card.png" style="height:auto">
        </td></tr></table></td></tr>
       </table></body></html>`,
      { "hero.png": [1400, 770], "card.png": [600, 1400] },
    );
    const a = await checkAcceptance(job.id);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
  }, 30_000);

  it("loading=lazy로 미룬 통짜 캡처도 거부한다 (6라운드 우회)", async () => {
    // load 이벤트를 기다리는 구현은 lazy 이미지를 0으로 재서 이미지 검사
    // 3개가 통째로 꺼졌다 — 최적화처럼 보이는 속성 하나로 게이트가 열렸다.
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p>` +
        `<img src="images/whole.png" loading="lazy" width="700" style="height:auto"></body></html>`,
      { "whole.png": [1400, 4414] },
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("스크린샷");
  }, 30_000);

  it("원격 URL 전폭 이미지는 거부한다 (크기를 검증할 수 없음)", async () => {
    // 요청을 끊으므로 깨진 이미지가 정사각형 상자로 측정된다 → 세로비 2 검사를
    // 통과했다(실측 재현). 크기를 못 믿는다는 사실 자체를 실패로 다룬다.
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p>` +
        `<img src="https://cdn.example.com/whole.png" width="700" style="height:auto"></body></html>`,
      {},
    );
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("불러올 수 없습니다");
  }, 30_000);

  it("hosted/ CDN 치환본이 있어도 최상단 산출물을 잰다", async () => {
    // hosting 라우트는 output/hosted/에 **같은 파일명으로** 치환본을 쓴다.
    // 그쪽을 재면 원격 이미지 검사에 걸려 정상 빌드가 실패하므로, readdir 순서에
    // 기대지 않고 최상단을 먼저 고른다는 불변식을 못 박는다.
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p><img src="images/hero.png" width="700" style="height:auto"></body></html>`,
      { "hero.png": [1400, 770] },
    );
    const hosted = path.join(outputDir(job.id), "hosted");
    await mkdir(hosted, { recursive: true });
    for (const name of ["edm_figma.html", "edm_responsive.html"]) {
      await writeFile(
        path.join(hosted, name),
        `<html><body><p>${BODY_COPY}</p><img src="https://cdn.example.com/hero.png" width="700" style="height:auto"></body></html>`,
      );
    }
    const a = await checkAcceptance(job.id);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
  }, 30_000);

  it("원격 추적 픽셀은 정상 빌드를 실패시키지 않는다", async () => {
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p><img src="images/hero.png" width="700" style="height:auto">` +
        `<img src="https://track.example.com/o.gif" width="1" height="1"></body></html>`,
      { "hero.png": [1400, 770] },
    );
    const a = await checkAcceptance(job.id);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
  }, 30_000);

  it("셀프컨테인(base64) 산출물의 이미지도 잰다", async () => {
    const png = realPng(700, 2207).toString("base64");
    const job = await jobWith(
      `<html><body><p>${BODY_COPY}</p>` +
        `<img src="data:image/png;base64,${png}" width="700" style="height:auto"></body></html>`,
      {},
    );
    const a = await checkAcceptance(job.id);
    expect(a.failures.join(" ")).toContain("스크린샷");
  }, 30_000);
});

describe("측정 실패의 의미 — 환경 문제와 산출물 불량을 구분한다", () => {
  /** DOMContentLoaded를 막는 산출물 (렌더 자체가 안 되는 상태). */
  const BLOCKING_HTML =
    `<html><body><script>const t=Date.now();while(Date.now()-t<4000){}</script>` +
    `<p>${BODY_COPY}</p></body></html>`;

  /** 탐색 제한 시간을 줄여 실패 경로를 빠르게 확인한다. */
  async function withShortTimeout<T>(fn: () => Promise<T>): Promise<T> {
    process.env.MHM_MEASURE_NAV_TIMEOUT_MS = "1200";
    try {
      return await fn();
    } finally {
      delete process.env.MHM_MEASURE_NAV_TIMEOUT_MS;
    }
  }

  it("렌더되지 않는 산출물은 경고가 아니라 실패다", async () => {
    // 경고로 강등하면 load를 막는 스크립트 한 줄로 반-우회 검사 3개가 전부
    // 꺼지고, compare.py는 자기 브라우저로 통짜 캡처를 PASS로 남긴다.
    const job = await fullJob();
    await writeFile(path.join(outputDir(job.id), "edm_figma.html"), BLOCKING_HTML);
    const a = await withShortTimeout(() => checkAcceptance(job.id));
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("브라우저에서 열지 못했습니다");
  }, 60_000);

  it("멈춘 파일이 다음 파일의 측정을 망가뜨리지 않는다", async () => {
    // 탭을 공유하면 앞 문서가 붙잡은 메인 스레드 때문에 뒤 파일도 전부
    // "측정 불가"가 되고, 실패가 엉뚱한 파일에 기록된다.
    const blocking = path.join(dir, "blocking.html");
    const good = path.join(dir, "after-blocking.html");
    await writeFile(blocking, BLOCKING_HTML);
    await writeFile(good, `<html><body><p>${BODY_COPY}</p></body></html>`);
    const [first, second] = await withShortTimeout(() => measureHtmlFiles([blocking, good]));
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.reason).toBe("render-failed");
    expect(second.ok, "앞 파일의 실패가 전이됐다").toBe(true);
    expect(second.ok && second.textChars).toBeGreaterThan(100);
  }, 60_000);

  it("이미 중단된 잡은 브라우저를 띄우지 않고 경고만 남긴다", async () => {
    const job = await fullJob();
    const controller = new AbortController();
    controller.abort();
    const t0 = performance.now();
    const a = await checkAcceptance(job.id, { signal: controller.signal });
    // 브라우저를 띄웠다면 초 단위가 걸린다.
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(a.failures.join(" ")).not.toContain("라이브 텍스트");
    expect(a.warnings.join(" ")).toContain("중단");
  }, 30_000);
});

describe("readVerifySummary", () => {
  it("알 수 없는 result 값은 null이다", async () => {
    const job = await fullJob(JSON.stringify({ result: "MAYBE" }));
    expect(await readVerifySummary(job.id)).toBeNull();
  }, 30_000);
});
