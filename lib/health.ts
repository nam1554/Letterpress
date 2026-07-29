import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
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
  const skillDir = path.join(os.homedir(), ".claude", "skills", "figma-edm");
  const ok = existsSync(skillDir);
  return {
    name: "figma-edm 스킬",
    ok,
    detail: ok ? skillDir : "~/.claude/skills/figma-edm 없음",
    hint: ok ? undefined : "figma-edm 스킬을 ~/.claude/skills/에 설치(또는 심링크)해야 변환 파이프라인이 동작합니다.",
  };
}

function checkChrome(): HealthCheck {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const ok = existsSync(chrome);
  return {
    name: "Google Chrome (픽셀 검증용)",
    ok,
    detail: ok ? "설치됨" : "미설치",
    hint: ok ? undefined : "픽셀 검증(compare.py)이 헤드리스 Chrome을 사용합니다. Chrome을 설치하세요.",
  };
}

async function checkPythonDeps(): Promise<HealthCheck> {
  try {
    await execFileAsync(
      "python3",
      ["-c", "import PIL, numpy, fontTools, brotli"],
      { timeout: 10_000 },
    );
    return { name: "Python 의존성 (PIL·numpy·fonttools·brotli)", ok: true, detail: "OK" };
  } catch {
    return {
      name: "Python 의존성 (PIL·numpy·fonttools·brotli)",
      ok: false,
      detail: "import 실패",
      hint: "python3 -m pip install pillow numpy fonttools brotli",
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
