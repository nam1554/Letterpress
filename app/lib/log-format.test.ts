import { describe, expect, it } from "vitest";
import { formatLogLine, shortenPath, type LogSegment } from "./log-format";

/** 세그먼트를 읽기 쉬운 형태로 눌러 비교용으로 쓴다. */
const flat = (segs: LogSegment[]) => segs.map((s) => `${s.kind}:${s.text}`).join("|");
/** 화면에 실제로 보이는 글자 — 기호가 남지 않았는지 확인하는 데 쓴다. */
const visible = (segs: LogSegment[]) =>
  segs.map((s) => (s.kind === "link" ? `${s.text} (${s.target})` : s.text)).join("");

const REPO = "/Users/example/projects/letterpress";

describe("shortenPath", () => {
  it("잡 작업 디렉터리 아래는 상대경로만 남긴다", () => {
    expect(shortenPath(`${REPO}/data/jobs/00ae9d9a/work/output/x.html`)).toBe("output/x.html");
  });

  it("work/ 없이 잡 디렉터리 직속인 것도 줄인다 (verify.json이 작업 루트에 있다)", () => {
    expect(shortenPath(`${REPO}/data/jobs/00ae9d9a/work/verify.json`)).toBe("verify.json");
    expect(shortenPath(`${REPO}/data/jobs/00ae9d9a/verify.json`)).toBe("verify.json");
  });

  it("레포 위치를 몰라도 동작한다 — 접두사가 아니라 data/jobs/<8hex>를 기준으로 삼는다", () => {
    expect(shortenPath("/somewhere/else/data/jobs/b23de8f2/work/output/images/hero.png")).toBe(
      "output/images/hero.png",
    );
  });

  it("잡 밖의 긴 절대경로는 뒤 두 조각만 남긴다", () => {
    expect(shortenPath(`${REPO}/skills/figma-edm/compare.py`)).toBe("…/figma-edm/compare.py");
  });

  it("짧은 경로는 그대로 둔다 — 줄여도 얻는 게 없고 뜻만 흐려진다", () => {
    expect(shortenPath("/mcp")).toBe("/mcp");
    expect(shortenPath("/api/mcp")).toBe("/api/mcp");
    expect(shortenPath("output/x.html")).toBe("output/x.html");
  });

  it("8-hex가 아닌 잡 id 모양은 잡 규칙에 걸리지 않는다", () => {
    // jobDir()가 8-hex를 강제하므로 그 밖의 것은 일반 절대경로로만 취급한다.
    expect(shortenPath("/x/data/jobs/NOTHEX/work/output/a.html")).toBe("…/output/a.html");
  });
});

describe("formatLogLine — 마크다운 기호 제거", () => {
  it("백틱을 code 세그먼트로 바꾸고 기호는 남기지 않는다", () => {
    const segs = formatLogLine("결과는 `RESULT: PASS` 입니다.");
    expect(flat(segs)).toBe("text:결과는 |code:RESULT: PASS|text: 입니다.");
    expect(visible(segs)).not.toContain("`");
  });

  it("**강조**를 strong 수정자로 바꾸고 별표는 남기지 않는다", () => {
    const segs = formatLogLine("**진행 로그** 시작");
    expect(segs).toEqual([
      { kind: "text", text: "진행 로그", strong: true },
      { kind: "text", text: " 시작" },
    ]);
    expect(visible(segs)).not.toContain("*");
  });

  it("강조가 코드를 감싼 실제 형태에서 안쪽 백틱까지 없앤다", () => {
    // 실제 로그: `**`verify.json` = PASS**`. 정규식 교대는 위치 우선이라 강조가
    // 먼저 잡히고 안쪽 백틱이 글자로 남았던 회귀.
    const segs = formatLogLine("**`verify.json` = PASS** 입니다");
    expect(segs).toEqual([
      { kind: "code", text: "verify.json", strong: true },
      { kind: "text", text: " = PASS", strong: true },
      { kind: "text", text: " 입니다" },
    ]);
    expect(visible(segs)).toBe("verify.json = PASS 입니다");
  });

  it("강조 안의 절대경로도 줄인다", () => {
    const segs = formatLogLine(`**${REPO}/data/jobs/00ae9d9a/work/output/x.html**`);
    expect(segs).toEqual([
      {
        kind: "path",
        text: "output/x.html",
        full: `${REPO}/data/jobs/00ae9d9a/work/output/x.html`,
        strong: true,
      },
    ]);
  });

  it("코드 스팬 안의 **는 글자로 남긴다 — 파이썬 소스가 로그에 찍힌다", () => {
    // 실제 tool 이벤트: `original_dump(obj, fp, *args, **kwargs)`.
    const segs = formatLogLine("`f(*args, **kwargs)` 호출");
    expect(segs[0]).toEqual({ kind: "code", text: "f(*args, **kwargs)" });
    expect(visible(segs)).toBe("f(*args, **kwargs) 호출");
  });

  it("실제 로그의 [라벨](<절대경로>) 형태를 라벨 + 줄인 경로로 만든다", () => {
    const raw = `완료했습니다. [Figma 고정형 HTML](<${REPO}/data/jobs/00ae9d9a/work/output/eyesurfer_channel_talk_figma.html>)과 …`;
    const segs = formatLogLine(raw);
    const link = segs.find((s) => s.kind === "link");
    expect(link).toEqual({
      kind: "link",
      text: "Figma 고정형 HTML",
      target: "output/eyesurfer_channel_talk_figma.html",
      full: `${REPO}/data/jobs/00ae9d9a/work/output/eyesurfer_channel_talk_figma.html`,
    });
    // 꺾쇠·대괄호·괄호가 화면에 남지 않는다.
    const v = visible(segs);
    expect(v).not.toContain("<");
    expect(v).not.toContain("](");
    expect(v).toContain("Figma 고정형 HTML (output/eyesurfer_channel_talk_figma.html)");
  });

  it("괄호만 있는 [라벨](경로) 형태도 처리한다", () => {
    const segs = formatLogLine("[문서](docs/x.md) 확인");
    expect(segs[0]).toMatchObject({ kind: "link", text: "문서", target: "docs/x.md" });
  });

  it("라벨이 줄인 경로와 같으면 같은 말을 두 번 쓰지 않는다", () => {
    // 실제 로그에 흔한 형태. 예전엔 `verify.json (verify.json)`으로 보였다.
    const full = `${REPO}/data/jobs/00ae9d9a/work/verify.json`;
    const segs = formatLogLine(`검증 산출물 [verify.json](<${full}>) 확인`);
    expect(segs[1]).toEqual({ kind: "path", text: "verify.json", full });
    expect(visible(segs)).toBe("검증 산출물 verify.json 확인");
  });
});

describe("formatLogLine — 경로", () => {
  it("링크 밖의 맨 절대경로도 줄인다 (전체의 30%가 이 형태)", () => {
    const segs = formatLogLine(`검증 산출물은 ${REPO}/data/jobs/00ae9d9a/work/verify.json 입니다.`);
    expect(flat(segs)).toBe("text:검증 산출물은 |path:verify.json|text: 입니다.");
  });

  it("전체 경로를 버리지 않는다 — 호버·복사로 닿아야 한다", () => {
    const full = `${REPO}/data/jobs/00ae9d9a/work/output/x.html`;
    const seg = formatLogLine(`파일 ${full}`).find((s) => s.kind === "path");
    expect(seg).toEqual({ kind: "path", text: "output/x.html", full });
  });

  it("URL 안쪽 경로는 망가뜨리지 않는다", () => {
    const url = "https://www.figma.com/api/mcp/asset/8c9ad10b-470d-4efe-829f-a30545125c26";
    const segs = formatLogLine(`$ curl -fsSL -o figma_full.png '${url}'`);
    expect(segs.some((s) => s.kind === "url" && s.text === url)).toBe(true);
    // URL이 path로 잘려 들어가면 안 된다.
    expect(segs.some((s) => s.kind === "path")).toBe(false);
    expect(visible(segs)).toContain(url);
  });

  it("한글이 경로에 딸려 들어가지 않는다", () => {
    const segs = formatLogLine(`${REPO}/data/jobs/00ae9d9a/work/output/x.html을 생성했고`);
    const p = segs.find((s) => s.kind === "path");
    expect(p?.text).toBe("output/x.html");
    expect(visible(segs)).toContain("을 생성했고");
  });
});

describe("formatLogLine — 견고성", () => {
  it("빈 문자열은 빈 배열", () => {
    expect(formatLogLine("")).toEqual([]);
  });

  it("기호가 없으면 통째로 text 하나", () => {
    expect(formatLogLine("작업 시작 — provider: Claude Code (local CLI)")).toEqual([
      { kind: "text", text: "작업 시작 — provider: Claude Code (local CLI)" },
    ]);
  });

  it("깨진 마크다운에도 던지지 않고 글자를 잃지 않는다", () => {
    for (const raw of ["**닫히지 않은", "`백틱 하나", "[라벨](", "](x)", "***", "``"]) {
      const segs = formatLogLine(raw);
      expect(visible(segs)).toBe(raw);
    }
  });

  it("여러 줄(\\n)을 가진 done 이벤트에서도 줄바꿈을 보존한다", () => {
    const segs = formatLogLine("완료: 파이프라인 완료\n\n**진행 로그**\n- ✅ 프레임 확보");
    const v = visible(segs);
    expect(v).toContain("\n\n");
    expect(v).toContain("✅ 프레임 확보");
    expect(v).not.toContain("**");
  });

  it("실제 done 이벤트 한 줄을 통과시킨다", () => {
    const raw =
      "완료: Pipeline complete — `RESULT: PASS`.\n\n**Progress log**\n- ✅ Frame pulled — `node-id=2343-115`";
    const segs = formatLogLine(raw);
    expect(visible(segs)).toBe(
      "완료: Pipeline complete — RESULT: PASS.\n\nProgress log\n- ✅ Frame pulled — node-id=2343-115",
    );
    expect(segs.filter((s) => s.kind === "code")).toHaveLength(2);
    expect(segs.filter((s) => s.strong)).toHaveLength(1);
  });
});
