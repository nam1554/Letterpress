import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer-core";
import { findChrome } from "../chrome";

/**
 * 산출물 HTML을 **실제 브라우저로 렌더해** 재는 모듈 — 품질 게이트의 반-우회
 * 검사가 여기에 기댄다.
 *
 * 왜 브라우저인가: 마크업만 보고 "실제로 보이는 것"을 계산하려던 구현은 코드
 * 리뷰 다섯 라운드에서 매번 새 오탐·우회를 만들었다. 파싱은 파서에 맡겨
 * 해결했지만(3라운드), 남은 문제는 **레이아웃**이었다 — 이메일은 표로 짜여
 * 자동 레이아웃 규칙이 지배하고(`<td width="300">`은 최소값이라 큰 이미지가
 * 칸을 늘린다), 캐스케이드·상속·미디어쿼리까지 규칙 몇 개로 근사할 수 없다.
 * `getComputedStyle`과 `getBoundingClientRect`는 그 답을 이미 알고 있다.
 *
 * 기준 렌더는 폭 700px 데스크톱 Chrome — compare.py가 픽셀 검증에 쓰는 화면과
 * 같다. 여기서 안 보이는 것은 사용자에게도 안 보인다.
 */

export const DESKTOP_WIDTH = 700;

export interface MeasuredImage {
  src: string;
  /** 실제 렌더된 표시 크기 (px). */
  width: number;
  height: number;
}

export interface Measured {
  /** 눈에 보이는 텍스트의 비공백 글자 수. */
  textChars: number;
  /** 화면에 실제로 렌더된 이미지들. */
  images: MeasuredImage[];
}

/** 페이지 안에서 실행되는 측정 스크립트. 브라우저 문맥이라 외부 참조 불가. */
function collect(): Measured {
  const isInvisible = (el: Element): boolean => {
    // 부모 체인의 opacity·visibility는 자손에게 그대로 내려온다.
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.visibility === "hidden" || style.visibility === "collapse") return true;
      if (Number.parseFloat(style.opacity) === 0) return true;
      // 0·1px로 잘린 상자 (sr-only 관용구)
      const box = node.getBoundingClientRect();
      if (style.overflow === "hidden" && (box.width <= 1 || box.height <= 1)) return true;
      // 화면 밖으로 밀어낸 것
      if (box.right < 1 || box.bottom < 1) return true;
    }
    return false;
  };

  let textChars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").replace(/\s+/g, "");
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    // display:none·잘린 요소는 렌더 사각형이 없다 — 브라우저의 판정을 그대로 쓴다.
    const range = document.createRange();
    range.selectNodeContents(node);
    if (range.getClientRects().length === 0) continue;
    const style = window.getComputedStyle(el);
    if (Number.parseFloat(style.fontSize) <= 0) continue;
    // 투명한 글자 — 알파는 rgba의 4번째 값만이다. rgb(0,0,0)의 세 번째 값을
    // 알파로 읽으면 검은 글자가 전부 투명으로 판정된다(실측으로 잡힌 버그).
    const channels = style.color.match(/^rgba?\(([^)]*)\)/);
    if (channels) {
      const parts = channels[1].split(",").map((v) => Number.parseFloat(v));
      if (parts.length >= 4 && parts[3] === 0) continue;
    }
    if (isInvisible(el)) continue;
    textChars += text.length;
  }

  const images: MeasuredImage[] = [];
  for (const img of Array.from(document.images)) {
    const box = img.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue; // 렌더되지 않음
    if (isInvisible(img)) continue;
    images.push({
      src: img.getAttribute("src") ?? "",
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }
  return { textChars, images };
}

/**
 * 산출물 파일을 데스크톱 폭으로 렌더해 보이는 텍스트·이미지를 잰다.
 * Chrome이 없으면 null — 호출부가 "판정 불가"로 다루게 한다(검사를 실패로
 * 바꾸면 Chrome이 없는 환경에서 정상 산출물까지 실패한다).
 */
export async function measureHtmlFile(file: string): Promise<Measured | null> {
  return (await measureHtmlFiles([file]))[0] ?? null;
}

/** 여러 파일을 브라우저 한 번으로 잰다 (실패한 파일은 null). */
export async function measureHtmlFiles(files: string[]): Promise<Array<Measured | null>> {
  const chrome = findChrome();
  if (!chrome) return files.map(() => null);
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      // compare.py와 같은 조건으로 띄운다 (헤드리스는 puppeteer가 붙인다).
      args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
      defaultViewport: { width: DESKTOP_WIDTH, height: 2600 },
      timeout: 30_000,
    });
    const page = await browser.newPage();
    // 로컬 파일만 연다. 원격 이미지는 없는 것으로 보고 넘어간다(느려지지 않게).
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (/^(file|data):/.test(req.url())) void req.continue();
      else void req.abort();
    });
    const out: Array<Measured | null> = [];
    for (const file of files) {
      try {
        await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });
        out.push(await page.evaluate(collect));
      } catch {
        out.push(null);
      }
    }
    return out;
  } catch {
    return files.map(() => null); // 브라우저를 못 띄우면 판정 불가
  } finally {
    await browser?.close().catch(() => {});
  }
}
