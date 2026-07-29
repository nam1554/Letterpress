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
    JSON.stringify({ figmaToken: "figd_SUPER_SECRET_TOKEN_1234", geminiApiKey: "AIzaSyFAKEKEY000" }),
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
    expect(raw).not.toContain("AIzaSyFAKEKEY000");
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
        "gemini 실패: GET https://generativelanguage.googleapis.com/v1?key=AIzaSyTESTKEY1234567 401",
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
