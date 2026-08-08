import { describe, expect, it } from "vitest";
import { checkEmailHtml } from "./email-check";
import {
  applyCdnTemplate,
  cdnTemplateProblem,
  isValidCdnFolder,
  isValidCdnTemplate,
  renderCdnUrl,
  swapEmbeddedFontsForCdn,
  templateNeedsFolder,
} from "./hosting";

describe("renderCdnUrl", () => {
  it("fills {file}/{name}/{ext} placeholders", () => {
    expect(renderCdnUrl("https://cdn.x/e/{file}", "hero.jpg")).toBe("https://cdn.x/e/hero.jpg");
    expect(
      renderCdnUrl("https://img.x/iiif/3/edm__{name}/full/max/0/default.{ext}", "hero.jpg"),
    ).toBe("https://img.x/iiif/3/edm__hero/full/max/0/default.jpg");
  });

  it("fills {folder} for per-campaign namespacing", () => {
    expect(
      renderCdnUrl(
        "https://img.x/iiif/3/{folder}__{file}/full/max/0/default.{ext}",
        "hero.png",
        "aisurfer_edm_20260729",
      ),
    ).toBe("https://img.x/iiif/3/aisurfer_edm_20260729__hero.png/full/max/0/default.png");
  });
});

describe("templateNeedsFolder / isValidCdnFolder", () => {
  it("detects the {folder} placeholder", () => {
    expect(templateNeedsFolder("https://x/{folder}/{file}")).toBe(true);
    expect(templateNeedsFolder("https://x/{file}")).toBe(false);
  });

  it("accepts url-safe folder names only", () => {
    expect(isValidCdnFolder("aisurfer_edm_20260729")).toBe(true);
    expect(isValidCdnFolder("a-b.c_d")).toBe(true);
    expect(isValidCdnFolder("한글")).toBe(false);
    expect(isValidCdnFolder("a b")).toBe(false);
    expect(isValidCdnFolder("a/b")).toBe(false);
    expect(isValidCdnFolder("")).toBe(false);
  });
});

describe("applyCdnTemplate", () => {
  it("replaces relative image srcs and counts them", () => {
    const html = `<img src="images/a.png"><img src='images/b.jpg'><img src="https://x/c.png">`;
    const { html: out, replaced, files } = applyCdnTemplate(html, "https://cdn.x/{file}");
    expect(replaced).toBe(2);
    expect(files).toEqual(["a.png", "b.jpg"]);
    expect(out).toContain('src="https://cdn.x/a.png"');
    expect(out).toContain("src='https://cdn.x/b.jpg'");
    expect(out).toContain('src="https://x/c.png"'); // 절대경로는 그대로
  });

  it("tolerates uppercase and spacing around src", () => {
    const html = `<IMG SRC="images/a.png"><img src = 'images/b.jpg'>`;
    const { replaced, html: out } = applyCdnTemplate(html, "https://cdn.x/{file}");
    expect(replaced).toBe(2);
    expect(out).toContain('SRC="https://cdn.x/a.png"');
    expect(out).toContain("src = 'https://cdn.x/b.jpg'");
  });

  it("replaces background attributes and CSS url() references too", () => {
    // 실전 결함: CTA 섹션이 background="images/…" + background-image:url('images/…')
    // 를 쓰는데 src만 치환하면 발송본에서 배경이 깨진다.
    const html =
      `<td background="images/cta_bg.png" style="background-image:url('images/cta_bg.png');">` +
      `<div style="background:url(images/dot.png) repeat;"></div></td>`;
    const { html: out, replaced, files } = applyCdnTemplate(html, "https://cdn.x/{file}");
    expect(replaced).toBe(3);
    expect(files).toEqual(["cta_bg.png", "dot.png"]);
    expect(out).toContain('background="https://cdn.x/cta_bg.png"');
    expect(out).toContain("background-image:url('https://cdn.x/cta_bg.png')");
    expect(out).toContain("background:url(https://cdn.x/dot.png) repeat;");
  });

  it("leaves absolute url() references alone", () => {
    const html = `<td style="background-image:url('https://x/keep.png');"></td>`;
    const { replaced, html: out } = applyCdnTemplate(html, "https://cdn.x/{file}");
    expect(replaced).toBe(0);
    expect(out).toBe(html);
  });

  it("threads the folder through to every replacement", () => {
    const html = `<img src="images/a.png"><img src="images/b.png">`;
    const { html: out } = applyCdnTemplate(html, "https://cdn.x/{folder}/{file}", "camp_20260729");
    expect(out).toContain('src="https://cdn.x/camp_20260729/a.png"');
    expect(out).toContain('src="https://cdn.x/camp_20260729/b.png"');
  });
});

describe("swapEmbeddedFontsForCdn", () => {
  const face = (w: number) =>
    `@font-face{font-family:'Pretendard';font-weight:${w};src:url("data:font/woff2;base64,AAAA") format('woff2');}`;

  it("removes base64 @font-face blocks and injects the CDN @import first in <style>", () => {
    const html = `<html><head><style>\n${face(400)}\n${face(700)}\n.t{color:#000}</style></head><body>x</body></html>`;
    const { html: out, removed } = swapEmbeddedFontsForCdn(html);
    expect(removed).toBe(2);
    expect(out).not.toContain("data:font");
    expect(out).toContain(".t{color:#000}"); // 다른 규칙은 보존
    const styleBody = out.slice(out.indexOf("<style>") + 7);
    expect(styleBody.trimStart().startsWith("@import url(")).toBe(true);
  });

  it("returns the input untouched when nothing is embedded", () => {
    const html = `<style>@import url('https://cdn.x/f.css');.t{}</style>`;
    const { html: out, removed } = swapEmbeddedFontsForCdn(html);
    expect(removed).toBe(0);
    expect(out).toBe(html);
  });
});

describe("isValidCdnTemplate", () => {
  it("requires https and a resolvable URL", () => {
    expect(isValidCdnTemplate("https://cdn.x/{file}")).toBe(true);
    expect(isValidCdnTemplate("http://cdn.x/{file}")).toBe(false);
    expect(isValidCdnTemplate("cdn.x/{file}")).toBe(false);
  });

  it("파일을 구분하지 못하는 템플릿을 거부한다", () => {
    // 실측(2026-08-08): `https://cdn.x/`가 통과해 모든 이미지가 같은 src로
    // 치환됐고, 화면에는 "교체본 생성 완료"만 떴다 — 조용히 깨진 발송본.
    expect(isValidCdnTemplate("https://cdn.x/")).toBe(false);
    expect(isValidCdnTemplate("https://cdn.x/{folder}/")).toBe(false);
    expect(isValidCdnTemplate("https://cdn.x/{folder}/x.{ext}")).toBe(false);
    // {name}만 있어도 파일마다 달라지므로 유효하다.
    expect(isValidCdnTemplate("https://cdn.x/{folder}/{name}.{ext}")).toBe(true);
  });

  it("막지 않았다면 모든 이미지가 같은 URL이 됐다는 사실을 고정한다", () => {
    const broken = applyCdnTemplate(
      '<img src="images/a.png"><img src="images/b.png">',
      "https://cdn.x/",
      "camp",
    );
    expect(broken.replaced).toBe(2);
    expect([...new Set(broken.html.match(/https:\/\/cdn\.x\/[^"]*/g) ?? [])]).toHaveLength(1);
  });
});

describe("cdnTemplateProblem — 라우트와 발송 준비 화면이 공유하는 판정", () => {
  it("문제마다 다른 이유를 돌려준다", () => {
    expect(cdnTemplateProblem("https://cdn.x/{folder}/{file}")).toBeNull();
    expect(cdnTemplateProblem("http://cdn.x/{file}")).toMatch(/https:\/\/ 로 시작/);
    expect(cdnTemplateProblem("https://cdn.x/{folder}/")).toMatch(/\{file\} 또는 \{name\}/);
  });

  it("스킴과 토큰이 동시에 잘못돼도 먼저 스킴을 알려준다", () => {
    // 실측(리뷰): 토큰 문제만 보고하면 사용자가 그것만 고치고 다시 400을 맞아
    // 왕복이 한 번 더 생겼다.
    const problem = cdnTemplateProblem("http://cdn.x/{folder}");
    expect(problem).toMatch(/https:\/\/ 로 시작/);
  });

  it("isValidCdnTemplate은 같은 판정을 불리언으로 돌려준다", () => {
    for (const t of ["https://cdn.x/{file}", "http://cdn.x/{file}", "https://cdn.x/", "cdn.x/{file}"]) {
      expect(isValidCdnTemplate(t), t).toBe(cdnTemplateProblem(t) === null);
    }
  });
});

describe("checkEmailHtml", () => {
  it("flags the checklist items", () => {
    const bad = `<script>x</script><img src="images/a.png"><a href="http://x">l</a><div style="background-image:url(b.png)"></div>`;
    const byName = Object.fromEntries(checkEmailHtml(bad).map((c) => [c.name, c.level]));
    expect(byName["스크립트"]).toBe("fail");
    expect(byName["이미지 alt"]).toBe("warn");
    expect(byName["배경 이미지"]).toBe("warn");
    expect(byName["비보안 링크"]).toBe("warn");
    expect(byName["이미지 경로"]).toBe("warn");
    expect(byName["프리헤더"]).toBe("warn");
  });

  it("does not mistake a stylesheet display:none for a preheader", () => {
    // 반응형 변형은 요소 숨김용 display:none을 <style>에 갖는다 — 이것이
    // 프리헤더로 오인되면 프리헤더 없는 파일이 거짓 통과한다 (실측: 73423ff3).
    const responsiveNoPreheader =
      `<style>@media(max-width:480px){.fsep{display:none!important}}</style>` +
      `<img src="https://cdn.x/a.png" alt="a">`;
    const check = checkEmailHtml(responsiveNoPreheader).find((c) => c.name === "프리헤더");
    expect(check?.level).toBe("warn");

    // 실제 프리헤더 관용구(인라인 style)는 통과해야 한다.
    const withPreheader =
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">미리보기 문구</div>`;
    expect(checkEmailHtml(withPreheader).find((c) => c.name === "프리헤더")?.level).toBe("ok");

    // display:none 앞에 인용부호 폰트명이 있어도 매치해야 한다 — 두 따옴표를
    // 모두 끊는 문자 클래스는 여기서 진짜 프리헤더를 놓친다 (리뷰 지적).
    const fontFirst =
      `<div style="font-family:'Pretendard',sans-serif;display:none;max-height:0;">문구</div>`;
    expect(checkEmailHtml(fontFirst).find((c) => c.name === "프리헤더")?.level).toBe("ok");
  });

  it("counts the same relative-image shapes the CDN swap rewrites", () => {
    // applyCdnTemplate이 치환하는 대소문자·공백·background=/url() 관용 —
    // 치환 대상인데 검사에는 안 잡히면 "상대경로 없음"이 거짓말이 된다.
    const html =
      `<img SRC = 'images/a.png' alt="a"><td background="images/b.png">` +
      `<div style="background:url('images/c.png')"></div>`;
    const path = checkEmailHtml(html).find((c) => c.name === "이미지 경로");
    expect(path?.level).toBe("warn");
    expect(path?.detail).toContain("3건");
  });

  it("passes a clean email", () => {
    const good = `<span style="display:none">preheader</span><img src="https://cdn.x/a.png" alt="a"><a href="https://x">l</a>`;
    const levels = checkEmailHtml(good).map((c) => c.level);
    expect(levels.every((l) => l === "ok")).toBe(true);
  });

  it("warns on Gmail clipping size", () => {
    const big = `<img src="https://x/a.png" alt="a">${"x".repeat(110 * 1024)}<span style="display:none">p</span>`;
    const size = checkEmailHtml(big).find((c) => c.name === "본문 용량");
    expect(size?.level).toBe("warn");
  });
});
