import { pathToFileURL } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
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
 *
 * 6라운드에서 고친 것(모두 실측으로 재현된 구멍):
 * - 판정은 **텍스트 자신의 사각형**으로 한다. 조상 상자로 재면 높이 0 래퍼 안의
 *   보이는 텍스트를 숨김으로 오인하고(오탐), `text-indent:-9999px`·
 *   `transform:scale(0)`으로 밀어낸 글자는 놓친다(우회).
 * - 가시성은 `Element.checkVisibility()`에 맡긴다 — `visibility:hidden` 래퍼는
 *   자손이 `visibility:visible`로 되돌릴 수 있어 조상을 직접 훑으면 오탐이 난다.
 * - `load` 이벤트를 기다리지 않는다. `loading="lazy"` 이미지는 load를 막지 않고
 *   0으로 측정돼 이미지 검사 3개가 통째로 꺼졌다 → 직접 eager로 바꿔 정착시킨다.
 * - 원격 이미지는 요청을 끊으므로 크기를 신뢰할 수 없다(깨진 이미지가 정사각형
 *   상자로 측정된다) → `loaded:false`로 표시해 호출부가 거부하게 한다.
 * - 색 구성(prefers-color-scheme)을 light로 고정한다. OS 테마를 물려받으면
 *   다크 모드 `display:none` 규칙이 정상 카피를 숨겨 머신마다 판정이 갈렸다.
 * - 파일마다 새 탭을 쓴다. 탭을 공유하면 앞 문서가 메인 스레드를 붙잡을 때
 *   뒤 파일까지 전부 "측정 불가"가 된다.
 */

export const DESKTOP_WIDTH = 700;

/**
 * 브라우저 세션을 한 번에 하나만 띄운다.
 *
 * 왜: 이 함수는 호출마다 Chrome을 새로 띄우는데, 호출자를 아무도 직렬화하지
 * 않았다. 동시 실행 한도가 잡 여러 개를 허용하므로 그것들이 비슷한 시각에
 * 끝나면(+ 게이트 미충족 시 자동 보수 후 재측정까지) 노트북에서 Chrome
 * 인스턴스가 겹쳐 뜬다.
 *
 * 그냥 느려지는 문제가 아니다. 자원 경쟁으로 **launch가 실패하면** 아래
 * catch가 그것을 "판정 불가"로 돌려주고, 게이트는 그걸 경고로 낮춘 뒤
 * **반-우회 검사 3종을 통째로 건너뛴다.** 즉 머신이 잠깐 붐볐다는 이유로
 * 스크린샷 빌드가 통과할 수 있다. 상한을 두는 편이 훨씬 싸다 — 실측
 * 측정 시간은 산출물 2개에 2.7초라 직렬화 비용이 거의 없다.
 *
 * **이것은 `acceptance.test.ts` 플레이크의 해결책이 아니다.** 그렇게 짐작하고
 * 고쳤다가 확인해 보니 브라우저를 띄우는 테스트 파일은 그 하나뿐이고 케이스도
 * 순차 실행이라, 애초에 동시 launch가 없었다. 그 플레이크는 스위트 전체의
 * CPU·메모리 압박에서 오는 것이므로 여기서 고칠 수 없다. 여기서 막는 것은
 * **런타임** 경쟁이다 — 동시 실행 한도가 허용한 잡들이 비슷한 시각에 끝날 때.
 *
 * 큐는 프로세스 안에서만 유효하다. 앱은 단일 서버 프로세스로 돌기 때문에
 * 그것으로 충분하다(vitest는 파일마다 워커가 달라 공유되지 않는다).
 */
let browserQueue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  // 앞 작업의 성공·실패 어느 쪽이든 이어서 실행한다.
  const run = browserQueue.then(fn, fn);
  // 큐 자체는 절대 reject 상태로 남기지 않는다 — 남기면 이후 전부 그 오류를
  // 물려받는다.
  browserQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface MeasuredImage {
  src: string;
  /** 실제 렌더된 표시 크기 (px). */
  width: number;
  height: number;
  /** 디코드까지 성공했는지 — 원격·깨진 src는 크기를 신뢰할 수 없다. */
  loaded: boolean;
}

export interface Measured {
  /** 눈에 보이는 텍스트의 비공백 글자 수. */
  textChars: number;
  /** 화면에 실제로 렌더된 이미지들. */
  images: MeasuredImage[];
}

/**
 * 측정 실패 사유 — 호출부가 "환경 문제(판정 불가)"와 "산출물 불량"을 구분해야
 * 한다. `render-failed`를 경고로 넘기면 load를 막는 스크립트 한 줄로 반-우회
 * 검사를 전부 끌 수 있다.
 */
/**
 * `no-chrome`은 **실행 파일을 못 찾은 것**, `launch-failed`는 찾았는데 **띄우지
 * 못한 것**이다. 둘 다 판정 불가지만 담당자가 할 일이 다르다 — 앞은 설치,
 * 뒤는 자원·프로필 문제다.
 */
export type MeasureFailure = "no-chrome" | "launch-failed" | "render-failed" | "aborted";

export type Measurement =
  | ({ ok: true } & Measured)
  | { ok: false; reason: MeasureFailure; detail?: string };

export interface MeasureOptions {
  /** 잡 취소·제한 시간 초과 시 브라우저를 즉시 닫는다. */
  signal?: AbortSignal;
}

/** 페이지 안에서 실행되는 측정 스크립트. 브라우저 문맥이라 외부 참조 불가. */
function collect(): Measured {
  // 700px 캔버스 밖(오른쪽)은 compare.py의 전체 캡처에도 잡히지 않는다.
  const viewWidth = window.innerWidth || 700;

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  /**
   * 브라우저 자신의 가시성 판정 — display:none, visibility, opacity,
   * content-visibility를 한 번에 본다. visibility는 자손이 visible로 되돌릴 수
   * 있으므로 조상을 직접 훑지 않고 이 API에 맡긴다.
   */
  const cssVisible = (el: Element): boolean =>
    el.checkVisibility({
      contentVisibilityAuto: true,
      opacityProperty: true,
      visibilityProperty: true,
    });

  /** 계산된 길이 하나를 px로. 퍼센트는 기준 길이에 대해 푼다. */
  const lengthPx = (raw: string, basis: number): number => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return Number.NaN;
    return raw.endsWith("%") ? (value / 100) * basis : value;
  };

  /**
   * `inset()`이 상자를 완전히 접었는지 — 값을 **숫자로 풀어** 남는 폭·높이를
   * 잰다. 자릿수를 세는 정규식(`[5-9]\d%`)은 `inset(50.5%)`처럼 소수점이 붙은
   * 유효한 sr-only 값을 놓쳐, 숨긴 텍스트가 라이브 텍스트 최소치를 채우는 데
   * 쓰일 수 있었다. 축마다 따로 보므로 `inset(0% 60%)`(가로만 접힘)도 잡힌다.
   */
  const insetCollapsed = (cp: string, el: Element): boolean => {
    const matched = /^inset\(([^)]*)\)/.exec(cp);
    if (!matched) return false;
    const parts = matched[1].trim().split(/\s+/).filter(Boolean);
    const round = parts.indexOf("round"); // inset(0 round 8px) — 반지름은 무시
    const vals = round === -1 ? parts : parts.slice(0, round);
    if (vals.length === 0 || vals.length > 4) return false;
    // CSS 축약: 1개=전부, 2개=(상하)(좌우), 3개=(상)(좌우)(하), 4개=상우하좌
    const [top, right = top, bottom = top, left = right] = vals;
    const rect = el.getBoundingClientRect();
    const height = rect.height - lengthPx(top, rect.height) - lengthPx(bottom, rect.height);
    const width = rect.width - lengthPx(left, rect.width) - lengthPx(right, rect.width);
    // 값을 못 읽으면 NaN이라 비교가 false → "안 잘렸다"로 남는다. 여기서 과감하게
    // 판정하면 이미지가 측정 목록에서 빠져 스크린샷 검사가 오히려 꺼진다.
    return width <= 1 || height <= 1;
  };

  /** sr-only 관용구(clip / clip-path)로 완전히 잘라냈는지. */
  const clippedAway = (el: Element, style: CSSStyleDeclaration): boolean => {
    // 레거시 clip은 배치된 요소에만 먹는다. rect(top,right,bottom,left).
    if (style.position !== "static" && style.clip.startsWith("rect(")) {
      const n = style.clip
        .slice(5, -1)
        .split(/[,\s]+/)
        .map((v) => Number.parseFloat(v));
      if (n.length === 4 && n.every((v) => Number.isFinite(v))) {
        if (n[1] - n[3] <= 1 || n[2] - n[0] <= 1) return true;
      }
    }
    const cp = style.clipPath;
    if (cp === "none") return false;
    if (insetCollapsed(cp, el)) return true;
    // circle(0)·circle(0.4%) — 반지름이 0 근방이면 아무것도 남지 않는다.
    // 퍼센트의 정확한 기준은 참조 상자의 대각선이지만, "0 근방"을 가리는
    // 목적에는 짧은 변으로 근사해도 결론이 바뀌지 않는다.
    const circle = /^circle\(\s*([^\s)]+)/.exec(cp);
    if (circle) {
      const rect = el.getBoundingClientRect();
      const radius = lengthPx(circle[1], Math.min(rect.width, rect.height));
      if (Number.isFinite(radius) && radius <= 0.5) return true;
    }
    return false;
  };

  /** 잘라내는 조상들과 교차시킨 실제 표시 사각형. 다 잘렸으면 null. */
  const visibleBox = (el: Element, rect: DOMRect): Box | null => {
    const box: Box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (clippedAway(node, style)) return null;
      const clipX = style.overflowX !== "visible";
      const clipY = style.overflowY !== "visible";
      if (!clipX && !clipY) continue;
      const clip = node.getBoundingClientRect();
      if (clipX) {
        box.left = Math.max(box.left, clip.left);
        box.right = Math.min(box.right, clip.right);
      }
      if (clipY) {
        box.top = Math.max(box.top, clip.top);
        box.bottom = Math.min(box.bottom, clip.bottom);
      }
      // 1px 이하로 남으면 sr-only 관용구다 (실측: codex 2차 우회).
      if (box.right - box.left <= 1 || box.bottom - box.top <= 1) return null;
    }
    return box;
  };

  /** 캔버스 안에 남아 있는지. 아래로는 제한을 두지 않는다(긴 이메일). */
  const onScreen = (box: Box | null): boolean =>
    box !== null && box.right > 0 && box.bottom > 0 && box.left < viewWidth;

  let textChars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").replace(/\s+/g, "");
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    // 렌더 사각형은 브라우저의 판정이다 — display:none·transform:scale(0)·
    // <style>/<script> 내용은 여기서 걸러진다.
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width >= 1 && r.height >= 1);
    if (rects.length === 0) continue;
    if (!cssVisible(el)) continue;
    const style = window.getComputedStyle(el);
    if (Number.parseFloat(style.fontSize) <= 0) continue;
    // 투명한 글자 — 알파는 4번째 성분만이다. rgb(0,0,0)의 세 번째 값을 알파로
    // 읽으면 검은 글자가 전부 투명으로 판정된다(실측으로 잡힌 버그).
    const channels = style.color.match(/^rgba?\(([^)]*)\)/);
    if (channels) {
      const parts = channels[1]
        .split(/[,/\s]+/)
        .filter(Boolean)
        .map((v) => Number.parseFloat(v));
      if (parts.length >= 4 && parts[3] === 0) continue;
    }
    if (!rects.some((r) => onScreen(visibleBox(el, r)))) continue;
    textChars += text.length;
  }

  const images: MeasuredImage[] = [];
  for (const img of Array.from(document.images)) {
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue; // 렌더되지 않음
    if (!cssVisible(img)) continue;
    if (!onScreen(visibleBox(img, rect))) continue;
    images.push({
      src: img.getAttribute("src") ?? "",
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      loaded: img.naturalWidth > 0 && img.naturalHeight > 0,
    });
  }
  return { textChars, images };
}

/**
 * 이미지·폰트가 자리를 잡을 때까지 기다린다 (페이지 안에서 실행).
 * `load` 이벤트만 믿으면 `loading="lazy"` 이미지가 0으로 측정돼 이미지 검사가
 * 통째로 꺼진다 — 실측으로 확인된 우회 경로다.
 */
async function settle(budgetMs: number): Promise<void> {
  const done = (async () => {
    const imgs = Array.from(document.images);
    for (const img of imgs) if (img.loading === "lazy") img.loading = "eager";
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );
    await document.fonts.ready.catch(() => {});
  })();
  await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, budgetMs))]);
}

/** 탐색 제한 시간 (기본 20초). 테스트에서 줄일 수 있게 환경 변수로 받는다. */
function navTimeoutMs(): number {
  const raw = Number(process.env.MHM_MEASURE_NAV_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

/** 산출물 파일 하나를 데스크톱 폭으로 렌더해 보이는 텍스트·이미지를 잰다. */
export async function measureHtmlFile(
  file: string,
  opts: MeasureOptions = {},
): Promise<Measurement> {
  return (await measureHtmlFiles([file], opts))[0];
}

/** 여러 파일을 브라우저 한 번으로 잰다 (탭은 파일마다 새로 연다). */
export async function measureHtmlFiles(
  files: string[],
  opts: MeasureOptions = {},
): Promise<Measurement[]> {
  const { signal } = opts;
  const aborted = (): Measurement => ({ ok: false, reason: "aborted" });
  if (signal?.aborted) return files.map(aborted);
  const chrome = findChrome();
  if (!chrome) return files.map(() => ({ ok: false, reason: "no-chrome" }));

  // 브라우저를 띄우는 구간 전체를 직렬화한다. 순서를 기다리는 동안 취소될 수
  // 있으므로 슬롯을 잡은 뒤 한 번 더 확인한다.
  return runExclusive(async () => {
    if (signal?.aborted) return files.map(aborted);
    return openAndMeasure(files, chrome, signal);
  });
}

async function openAndMeasure(
  files: string[],
  chrome: string,
  signal: AbortSignal | undefined,
): Promise<Measurement[]> {
  const aborted = (): Measurement => ({ ok: false, reason: "aborted" });
  const timeout = navTimeoutMs();
  let browser: Browser | undefined;
  // 취소되면 브라우저를 즉시 닫는다 — 잡의 종료 상태가 측정 끝날 때까지
  // 밀리면 사용자는 "실행 중"만 계속 본다.
  const onAbort = () => void browser?.close().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      // compare.py와 같은 조건으로 띄운다 (헤드리스는 puppeteer가 붙인다).
      args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
      defaultViewport: { width: DESKTOP_WIDTH, height: 2600 },
      timeout,
    });
    // 띄우는 동안 취소됐다면 리스너가 놓친 브라우저를 여기서 닫는다.
    if (signal?.aborted) return files.map(aborted);

    const out: Measurement[] = [];
    for (const file of files) {
      if (signal?.aborted) {
        out.push(aborted());
        continue;
      }
      let page: Page | undefined;
      try {
        page = await browser.newPage();
        page.setDefaultTimeout(timeout);
        // 색 구성을 고정한다 — 안 하면 OS 테마를 물려받아 다크 모드
        // display:none 규칙이 정상 카피를 숨긴다(머신마다 판정이 갈렸다).
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
        // 로컬 파일만 연다. 원격 리소스는 끊고, 크기를 못 믿는다는 사실은
        // loaded:false로 호출부에 넘긴다.
        await page.setRequestInterception(true);
        page.on("request", (req) => {
          const allowed = /^(file|data|blob|about):/.test(req.url());
          void (allowed ? req.continue() : req.abort()).catch(() => {});
        });
        // load는 기다리지 않는다 (lazy 이미지) — DOM만 받고 직접 정착시킨다.
        await page.goto(pathToFileURL(file).href, { waitUntil: "domcontentloaded", timeout });
        await page.evaluate(settle, Math.min(timeout, 10_000));
        out.push({ ok: true, ...(await page.evaluate(collect)) });
      } catch (err) {
        out.push(
          signal?.aborted
            ? aborted()
            : { ok: false, reason: "render-failed", detail: errorLine(err) },
        );
      } finally {
        await page?.close().catch(() => {});
      }
    }
    return out;
  } catch (err) {
    // 브라우저 자체를 못 띄웠다 — 산출물 불량이 아니라 환경 문제(판정 불가).
    // no-chrome이 아니라 launch-failed다: 여기 오려면 findChrome()이 이미
    // 경로를 찾은 뒤이므로 "Chrome을 찾지 못함"은 거짓말이고, 진단 파일을
    // 받은 담당자가 설치를 안내하다 진짜 원인(자원 부족·프로필 잠김 등)을
    // 놓친다.
    if (signal?.aborted) return files.map(aborted);
    return files.map(() => ({ ok: false, reason: "launch-failed", detail: errorLine(err) }));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser?.close().catch(() => {});
  }
}

function errorLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
}
