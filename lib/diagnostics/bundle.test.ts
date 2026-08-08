import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-diag-"));
  process.env.MHM_SETTINGS_FILE = path.join(dir, "settings.json");
  await writeFile(
    process.env.MHM_SETTINGS_FILE,
    JSON.stringify({ figmaToken: "figd_SUPER_SECRET_TOKEN_1234" }),
  );
});

afterAll(async () => {
  delete process.env.MHM_SETTINGS_FILE;
  await rm(dir, { recursive: true, force: true });
});

import { maskedSettings, scrub, scrubForBundle } from "./bundle";

describe("진단 번들 — 비밀값", () => {
  it("설정의 토큰·키는 값 없이 '설정됨'으로만 나간다", () => {
    const masked = maskedSettings();
    const raw = JSON.stringify(masked);
    expect(raw).not.toContain("figd_SUPER_SECRET_TOKEN_1234");
    expect(String(masked.figmaToken)).toContain("설정됨");
    // 비밀이 아닌 설정은 그대로 보여야 진단에 쓸모가 있다.
    expect(masked.maxConcurrentJobs).toBeDefined();
  });

  it("로그 본문에 찍힌 비밀값도 지운다", () => {
    const log = "요청 실패: X-Figma-Token: figd_SUPER_SECRET_TOKEN_1234 (401)";
    const out = scrub(log, ["figd_SUPER_SECRET_TOKEN_1234"]);
    expect(out).not.toContain("SUPER_SECRET");
    expect(out).toContain("지움");
  });

  it("등록되지 않은 토큰 형태도 보수적으로 가린다", () => {
    // 설정에 없는(예: 다른 계정의) 값이 로그에 섞여도 새어 나가면 안 된다.
    const text = "keys: figd_abcdefghijklmno sk-abcdefghijklmnop AIzaXyzabcdefghij";
    const out = scrub(text, []);
    expect(out).not.toContain("figd_abcdefghijklmno");
    expect(out).not.toContain("sk-abcdefghijklmnop");
    expect(out).not.toContain("AIzaXyzabcdefghij");
  });

  it("정규식 특수문자가 든 비밀값도 안전하게 지운다", () => {
    const weird = "a+b(c)[d].*e";
    expect(scrub(`token=${weird} 끝`, [weird])).not.toContain(weird);
  });
});

describe("진단 번들 — 잡 파일 경로", () => {
  it("job.summary(=CLI stderr 꼬리)에 섞인 토큰도 지운다", () => {
    // 인증 실패 시 프로바이더가 stderr 꼬리를 그대로 요약에 넣는다.
    const job = {
      id: "abc12345",
      summary:
        "백엔드 실패: GET https://generativelanguage.googleapis.com/v1?key=AIzaSyTESTKEY1234567 401",
    };
    const out = scrubForBundle(JSON.stringify(job));
    expect(out).not.toContain("AIzaSyTESTKEY1234567");
  });

  it("설정에 저장된 토큰이 이벤트 로그에 찍혀도 지운다 (형태가 달라도)", () => {
    // 구형 Figma 토큰은 figd_ 접두어가 없다 — 정규식만으로는 못 잡는다.
    const events =
      '{"type":"log","text":"curl -H \'X-Figma-Token: figd_SUPER_SECRET_TOKEN_1234\' ..."}';
    expect(scrubForBundle(events)).not.toContain("SUPER_SECRET");
  });
});

describe("진단 번들 — summary.md의 백엔드 완주 기록", () => {
  // 리뷰 Minor 2: ready만 적고 verification을 안 적으면 사람이 읽는 페이지에서
  // "이 백엔드가 실제로 끝까지 동작한 적은 있나"를 답할 수 없다.
  it("각 백엔드 줄에 준비 상태뿐 아니라 완주 기록도 싣는다", async () => {
    // 이 테스트는 summary.md 포맷팅만 검증한다 — 실제 CLI 진단
    // (getBackendSetup)이 동작하는지는 관심사가 아니고, claudeSetup()의
    // `mcp list`가 최대 45초까지 걸려 전체 스위트 부하 아래에서는 30초 예산을
    // 넘겨 간헐 실패했다(단독 실행 시에는 통과). 실제 CLI를 스폰하지 않도록
    // getBackendSetup을 주입한다 — buildSummary의 프로덕션 경로(bundleTexts가
    // 인자 없이 부르는 경우)는 그대로 실제 getBackendSetup을 쓴다.
    const { buildSummary } = await import("./bundle");
    const summary = await buildSummary(
      { jobs: [] },
      {
        getBackendSetup: async () => [
          {
            id: "claude-code",
            label: "Claude Code",
            ready: true,
            verification: "verified",
            verificationNote: "",
            steps: [{ name: "CLI 설치", ok: true, detail: "claude 1.0.0" }],
          },
          {
            id: "codex",
            label: "Codex",
            ready: false,
            verification: "sample",
            verificationNote: "",
            steps: [{ name: "CLI 설치", ok: false, detail: "미설치" }],
          },
          {
            id: "mock",
            label: "Mock",
            ready: true,
            verification: "unverified",
            verificationNote: "",
            steps: [{ name: "준비", ok: true, detail: "항상 사용 가능" }],
          },
        ],
      },
    );
    const backendSection = summary.split("## 백엔드 연동")[1]?.split("## ")[0] ?? "";
    expect(backendSection).toMatch(/완주 기록:/);
    expect(backendSection).toMatch(/검증됨|미검증|샘플 전용/);
  });
});

describe("진단 번들 — '포함된 것' 목록이 실제 내용과 맞는가", () => {
  const stubSetup = { getBackendSetup: async () => [] };

  it("작업 없이 받은 번들은 job/ 이 있다고 적지 않는다", async () => {
    // 실측(2026-08-08): 홈에서 받은 번들에도 "job/ — 신고 대상 작업의 …"이
    // 적혀 있어, 받은 사람이 없는 폴더를 찾게 됐다.
    const { buildSummary } = await import("./bundle");
    const summary = await buildSummary({ jobs: [] }, stubSetup);
    const section = summary.split("## 포함된 것")[1] ?? "";
    expect(section).toContain("job/ 는 없습니다");
    expect(section).not.toMatch(/- job\/ — 신고 대상/);
  });

  it("작업을 지정해 받은 번들은 job/ 구성을 안내한다", async () => {
    const { buildSummary } = await import("./bundle");
    const job = {
      id: "0c12f6ac",
      figmaUrl: "https://www.figma.com/design/x/y",
      provider: "mock",
      status: "succeeded" as const,
      createdAt: Date.now(),
    };
    const summary = await buildSummary({ jobs: [job], job }, stubSetup);
    const section = summary.split("## 포함된 것")[1] ?? "";
    expect(section).toMatch(/- job\/ — 신고 대상/);
  });
});

describe("진단 번들 — 모든 항목이 문을 지나는가", () => {
  it("번들에 실리는 텍스트 중 스크럽을 건너뛴 항목이 없다", async () => {
    // health.json이 그 구멍이었다 — CLI 오류 원문(detail)이 그대로 실렸다.
    const { bundleTexts } = await import("./bundle");
    const texts = await bundleTexts({ jobs: [] });
    const secret = "figd_SUPER_SECRET_TOKEN_1234";
    for (const [name, content] of Object.entries(texts)) {
      expect(content, `${name}에 비밀값이 남아 있다`).not.toContain(secret);
    }
    // 최소한 이 항목들은 반드시 들어 있어야 검사가 의미가 있다.
    expect(Object.keys(texts)).toEqual(
      expect.arrayContaining(["summary.md", "settings.json", "health.json", "backends.json"]),
    );
  }, 30_000);
});
