import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** How to fix it — shown to teammates when ok=false. */
  hint?: string;
  /** Optional backends: failure is informational, not a blocker. */
  optional?: boolean;
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

async function checkGeminiCli(): Promise<HealthCheck> {
  const name = "Gemini CLI (선택 백엔드)";
  try {
    const { stdout } = await execFileAsync(process.env.GEMINI_BIN ?? "gemini", ["--version"], {
      timeout: 10_000,
    });
    const authed = existsSync(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
    return {
      name,
      ok: authed,
      optional: true,
      detail: authed ? `v${stdout.trim()} · 로그인됨` : `v${stdout.trim()} · 로그인 필요`,
      hint: authed ? undefined : "터미널에서 `gemini`를 한 번 실행해 구글 계정으로 로그인하세요.",
    };
  } catch {
    return {
      name,
      ok: false,
      optional: true,
      detail: "미설치",
      hint: "npm i -g @google/gemini-cli 후 `gemini` 첫 실행에서 구글 로그인",
    };
  }
}

async function checkCodexCli(): Promise<HealthCheck> {
  const name = "Codex CLI (선택 백엔드)";
  try {
    await execFileAsync(process.env.CODEX_BIN ?? "codex", ["--version"], { timeout: 10_000 });
  } catch {
    return {
      name,
      ok: false,
      optional: true,
      detail: "미설치",
      hint: "npm i -g @openai/codex 후 `codex login` (ChatGPT 계정)",
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      process.env.CODEX_BIN ?? "codex",
      ["login", "status"],
      { timeout: 10_000 },
    );
    const detail = (stdout.trim() || stderr.trim()).split("\n")[0] || "로그인됨";
    return { name, ok: true, optional: true, detail };
  } catch {
    return {
      name,
      ok: false,
      optional: true,
      detail: "로그인 필요",
      hint: "터미널에서 `codex login` 실행 (ChatGPT Plus/Pro 계정 브라우저 인증)",
    };
  }
}

export async function runHealthChecks(force = false): Promise<HealthCheck[]> {
  const cached = g.__mhmHealth;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.checks;

  const checks = [
    ...(await Promise.all([
      checkClaudeCli(),
      checkPythonDeps(),
      checkGeminiCli(),
      checkCodexCli(),
    ])),
    checkFigmaEdmSkill(),
    checkChrome(),
  ];
  g.__mhmHealth = { at: Date.now(), checks };
  return checks;
}
