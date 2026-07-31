import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findChrome } from "../chrome";
import { runHealthChecks } from "../health";
import type { Job } from "../jobs/store";
import { findPython } from "../python";
import { getSettings } from "../settings";
import { getBackendSetup, type BackendSetup } from "../setup";
import { readRecentLog } from "./log";

const execFileAsync = promisify(execFile);

/**
 * 문제 신고용 진단 번들 — 사용자가 폴더를 뒤지지 않고 버튼 하나로 받아
 * 그대로 전달할 수 있는 파일 한 개를 만든다.
 *
 * 원칙: 담을 것은 넉넉히, 비밀은 절대로. 설정에는 Figma 토큰이 들어 있고,
 * 로그에 그 값이 찍혀 있을 수도 있다. 값 자체를 문자열 치환으로 지운 뒤에만
 * 번들에 넣는다.
 */

/** 설정에 저장된 비밀값들 — 번들 어디에서든 이 문자열은 지운다. */
function secrets(): string[] {
  const { figmaToken } = getSettings();
  return [figmaToken].filter((s): s is string => Boolean(s) && s.length >= 8);
}

/**
 * 번들에 넣기 전 반드시 거쳐야 하는 문(門) — 저장된 비밀값 + 토큰 형태를 함께
 * 지운다. 호출부가 비밀 목록을 직접 넘기게 두면 빈 배열로 부르는 실수가 나고,
 * 그 파일 하나만 평문으로 새어 나간다(실제로 job.json·events.ndjson이 그랬다).
 */
export function scrubForBundle(text: string): string {
  return scrub(text, secrets());
}

/** 텍스트에서 알려진 비밀값을 지운다. */
export function scrub(text: string, values: string[]): string {
  let out = text;
  for (const value of values) {
    // 정규식 특수문자를 그대로 다루려면 split/join이 안전하다.
    out = out.split(value).join("***지움***");
  }
  // 토큰처럼 보이는 값도 보수적으로 가린다 (figd_·sk-·AIza…).
  return out
    .replace(/\b(figd_|figu_)[A-Za-z0-9_-]{10,}/g, "$1***지움***")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "sk-***지움***")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, "AIza***지움***");
}

/** 저장된 설정을 비밀값만 가린 형태로. */
export function maskedSettings(): Record<string, unknown> {
  const s = getSettings() as unknown as Record<string, unknown>;
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(s)) {
    const secretish = /token|key|secret/i.test(key);
    masked[key] =
      secretish && typeof value === "string" && value
        ? `(설정됨, ${value.length}자 — 값은 제외)`
        : value;
  }
  return masked;
}

async function version(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 10_000 });
    return stdout.trim().split("\n")[0];
  } catch (err) {
    return `확인 불가 (${(err as Error).message.split("\n")[0]})`;
  }
}

export interface BundleInput {
  jobs: Job[];
  /** 문제가 난 잡 (선택). */
  job?: Job | null;
}

/**
 * 테스트가 실제 CLI 스폰(최대 45초, `claudeSetup`의 `mcp list`)을 피할 수
 * 있도록 백엔드 진단 함수를 주입 가능하게 뒀다. 생략하면 프로덕션과 동일하게
 * `getBackendSetup`을 그대로 쓴다 — 실제 출력은 바뀌지 않는다.
 */
export interface BuildSummaryDeps {
  getBackendSetup?: (force?: boolean) => Promise<BackendSetup[]>;
}

/** 사람이 먼저 읽을 요약 — 여는 순간 상황이 보이게. */
export async function buildSummary(
  input: BundleInput,
  deps: BuildSummaryDeps = {},
): Promise<string> {
  const backendSetup = deps.getBackendSetup ?? getBackendSetup;
  const python = await findPython();
  const [health, backends, appVersion, gitRev] = await Promise.all([
    runHealthChecks(true).catch(() => []),
    backendSetup(false).catch(() => []),
    readFile(path.join(process.cwd(), "package.json"), "utf8")
      .then((raw) => JSON.parse(raw).version as string)
      .catch(() => "unknown"),
    version("git", ["rev-parse", "--short", "HEAD"]),
  ]);

  const lines: string[] = [
    "# Letterpress 진단 파일",
    "",
    `만든 시각: ${new Date().toLocaleString("ko-KR")}`,
    `앱 버전: ${appVersion} (git ${gitRev})`,
    `OS: ${process.platform} ${process.arch} · Node ${process.version}`,
    `Chrome: ${findChrome() ?? "찾지 못함"}`,
    `Python: ${python ? [python.bin, ...python.args].join(" ") : "찾지 못함"}`,
    "",
    "## 환경 점검",
    ...(health.length === 0
      ? ["(점검 실패)"]
      : health.map((c) => `- [${c.ok ? "OK" : "문제"}] ${c.name}: ${c.detail}`)),
    "",
    "## 백엔드 연동",
    ...(backends.length === 0
      ? ["(진단 없음)"]
      : backends.map(
          (b) =>
            `- ${b.label}: ${b.ready ? "준비됨" : "준비 안 됨"}` +
            ` · 완주 기록: ${b.verification === "verified" ? "검증됨" : b.verification === "sample" ? "샘플 전용" : "미검증"}` +
            ` — ${b.steps.map((s) => `${s.name}=${s.ok === null ? "?" : s.ok ? "OK" : "실패"}`).join(", ")}`,
        )),
    "",
    "## 최근 작업",
    ...(input.jobs.length === 0
      ? ["(없음)"]
      : input.jobs
          .slice(0, 10)
          .map(
            (j) =>
              `- ${j.id} ${j.status} · ${j.provider} · ${new Date(j.createdAt).toLocaleString("ko-KR")}` +
              (j.summary ? `\n    ${j.summary.split("\n")[0].slice(0, 160)}` : ""),
          )),
  ];

  if (input.job) {
    lines.push(
      "",
      "## 신고 대상 작업",
      `- id: ${input.job.id}`,
      `- 상태: ${input.job.status}`,
      `- 백엔드: ${input.job.provider}`,
      `- Figma: ${input.job.figmaUrl}`,
      `- 검증: ${input.job.verify ? JSON.stringify(input.job.verify) : "없음"}`,
      `- 요약: ${input.job.summary ?? "(없음)"}`,
    );
  }

  lines.push(
    "",
    "## 포함된 것",
    "- summary.md(이 파일) · health.json · backends.json · settings.json(비밀값 제외)",
    "- logs/app.log — 서버에서 난 오류",
    "- logs/launcher.log — 런처의 설치·빌드 기록(시작-기록.log, 있는 경우)",
    "- job/ — 신고 대상 작업의 job.json · events.ndjson · verify.json · artifacts.txt",
    "",
    "Figma URL·작업 요약·로그 본문이 들어 있습니다. 토큰과 API 키는 값이 제외됩니다.",
  );
  return scrub(lines.join("\n"), secrets());
}

/** 번들에 넣을 텍스트 파일들 (경로 → 내용). 파일 스트림은 라우트가 따로 붙인다. */
export async function bundleTexts(input: BundleInput): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    "summary.md": await buildSummary(input),
    "settings.json": scrubForBundle(JSON.stringify(maskedSettings(), null, 2)),
  };
  const health = await runHealthChecks(false).catch(() => []);
  // detail에 CLI 오류 원문이 담긴다 — 여기도 예외 없이 문을 지난다.
  out["health.json"] = scrubForBundle(JSON.stringify(health, null, 2));
  const backends = await getBackendSetup(false).catch(() => []);
  out["backends.json"] = scrubForBundle(JSON.stringify(backends, null, 2));
  const log = readRecentLog();
  if (log) out["logs/app.log"] = scrubForBundle(log);
  const launcherLog = await readFile(path.join(process.cwd(), "시작-기록.log"), "utf8").catch(
    () => "",
  );
  if (launcherLog) out["logs/launcher.log"] = scrubForBundle(launcherLog.slice(-300_000));
  return out;
}
