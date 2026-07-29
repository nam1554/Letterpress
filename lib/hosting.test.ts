import { describe, expect, it } from "vitest";
import { checkEmailHtml } from "./email-check";
import {
  applyCdnTemplate,
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
