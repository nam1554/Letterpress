import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { findChrome } from "./chrome";
import { findPython } from "./python";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// 선택 백엔드(Gemini/Codex)의 상세 진단은 lib/setup.ts(백엔드 연동 카드)가 담당한다.
// 여기는 기본 변환 경로에 필수인 항목만 다룬다.
export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** How to fix it — shown to teammates when ok=false. */
  hint?: string;
}

const CACHE_MS = 60_000;
const g = globalThis as unknown as {
  __mhmHealth?: { at: number; checks: HealthCheck[] };
};

async function checkClaudeCli(): Promise<HealthCheck> {
  try {
    const { stdout } = await execFileAsync(process.env.CLAUDE_BIN ?? "claude", ["--version"], {
      timeout: 10_000,
    });
    return { name: "Claude Code CLI", ok: true, detail: stdout.trim() };
  } catch (err) {
    return {
      name: "Claude Code CLI",
      ok: false,
      detail: (err as Error).message.split("\n")[0],
      hint: "claude CLI를 설치하고 `claude` 로그인 후 다시 시도하세요 (https://claude.com/claude-code).",
    };
  }
}

function checkFigmaEdmSkill(): HealthCheck {
  // 스킬은 레포에 벤더링됨 (skills/figma-edm) — clone만으로 있어야 정상.
  const skillDir = path.join(process.cwd(), "skills", "figma-edm");
  const ok = existsSync(path.join(skillDir, "SKILL.md"));
  return {
    name: "figma-edm 스킬",
    ok,
    detail: ok ? skillDir : "skills/figma-edm 없음",
    hint: ok
      ? undefined
      : "레포의 skills/figma-edm이 없습니다 — git 체크아웃이 손상됐는지 확인하세요.",
  };
}

function checkChrome(): HealthCheck {
  const chrome = findChrome();
  return {
    name: "Google Chrome (픽셀 검증용)",
    ok: chrome !== null,
    detail: chrome ?? "미설치",
    hint: chrome
      ? undefined
      : "픽셀 검증(compare.py)이 헤드리스 Chrome을 사용합니다 — https://www.google.com/chrome 에서 설치하세요. " +
        "표준 위치가 아닌 곳에 설치했다면 CHROME_BIN 환경변수로 경로를 지정할 수 있습니다.",
  };
}

async function checkPythonDeps(): Promise<HealthCheck> {
  const name = "Python 의존성 (PIL·numpy·fonttools·brotli)";
  // 터미널이 낯선 사용자를 위해: 런처가 물어보고 대신 설치해 준다.
  const launcher = process.platform === "win32" ? "시작하기.bat" : "시작하기.command";
  const python = await findPython();
  if (!python) {
    return {
      name,
      ok: false,
      detail: "파이썬 없음",
      hint:
        `${launcher}를 다시 실행하면 안내합니다. 직접 설치하려면 https://www.python.org/downloads 에서 받으세요` +
        (process.platform === "win32" ? " (설치 화면의 'Add python.exe to PATH'를 체크)." : "."),
    };
  }
  try {
    await execFileAsync(
      python.bin,
      [...python.args, "-c", "import PIL, numpy, fontTools, brotli"],
      { timeout: 10_000 },
    );
    return { name, ok: true, detail: "OK" };
  } catch {
    const cmd = [python.bin, ...python.args].join(" ");
    return {
      name,
      ok: false,
      detail: "import 실패",
      hint: `${launcher}를 다시 실행하면 설치 여부를 물어봅니다. 직접 하려면: ${cmd} -m pip install pillow numpy fonttools brotli`,
    };
  }
}

export async function runHealthChecks(force = false): Promise<HealthCheck[]> {
  const cached = g.__mhmHealth;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.checks;

  const checks = [
    ...(await Promise.all([checkClaudeCli(), checkPythonDeps()])),
    checkFigmaEdmSkill(),
    checkChrome(),
  ];
  g.__mhmHealth = { at: Date.now(), checks };
  return checks;
}
