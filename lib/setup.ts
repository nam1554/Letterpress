import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getProvider, listProviders } from "./providers/registry";
import { getSettings } from "./settings";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = () => process.env.CLAUDE_BIN ?? "claude";
const GEMINI_BIN = () => process.env.GEMINI_BIN ?? "gemini";
const CODEX_BIN = () => process.env.CODEX_BIN ?? "codex";

// ---------------------------------------------------------------------------
// Figma MCP 연결 상태 파서 — 각 CLI의 `mcp list` 출력에서 figma 항목을 찾는다.
// 실측 출력(2026-07-29) 기반. 순수 함수로 분리해 유닛 테스트한다.
// ---------------------------------------------------------------------------

export type McpStatus = "connected" | "registered" | "missing";

const findFigmaLine = (out: string): string | undefined =>
  out.split("\n").find((l) => /figma/i.test(l));

/** `claude mcp list`: "claude.ai Figma: https://mcp.figma.com/mcp - ✔ Connected" */
export function figmaMcpFromClaudeList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  return /[✔✓]/.test(line) ? "connected" : "registered";
}

/** `codex mcp list`: 테이블 행 "figma  https://mcp.figma.com/mcp  -  enabled  OAuth" */
export function figmaMcpFromCodexList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  return /\benabled\b/i.test(line) ? "connected" : "registered";
}

/** `gemini mcp list`: "✗ figma: https://mcp.figma.com/mcp (http) - Disconnected" */
export function figmaMcpFromGeminiList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  if (/[✔✓]/.test(line)) return "connected";
  // 심볼이 없는 포맷 대비: "Disconnected"를 지운 뒤 "Connected"가 남는지 확인
  return /\bconnected\b/i.test(line.replace(/disconnected/gi, "")) ? "connected" : "registered";
}

// ---------------------------------------------------------------------------
// 백엔드별 연동 상태 — 설치 → 인증 → Figma 접근을 단계로 진단한다.
// ---------------------------------------------------------------------------

export interface SetupStep {
  name: string;
  /** true=통과, false=조치 필요, null=확인 불가(차단 아님) */
  ok: boolean | null;
  detail: string;
  hint?: string;
  /** 복사해 터미널에 붙여넣을 수 있는 해결 명령 */
  command?: string;
}

export interface BackendSetup {
  id: string;
  label: string;
  /** 명시적으로 실패한 단계가 없으면 true (ok=null은 차단하지 않음) */
  ready: boolean;
  steps: SetupStep[];
}

async function cliVersion(bin: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 10_000 });
    return { ok: true, detail: stdout.trim().split("\n")[0] || "설치됨" };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.split("\n")[0] };
  }
}

/** `mcp list` 실행 — 실패/타임아웃이면 null(확인 불가). */
async function mcpList(bin: string, timeout: number): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, ["mcp", "list"], { timeout });
    return `${stdout}\n${stderr}`;
  } catch (err) {
    // CLI가 목록을 stderr로 내면서 non-zero 종료하는 경우도 파싱을 시도한다.
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return findFigmaLine(out) ? out : null;
  }
}

const figmaTokenSet = () =>
  Boolean(getSettings().figmaToken || process.env.FIGMA_TOKEN);

/** MCP 상태 + Figma 토큰 폴백을 하나의 "Figma 접근" 단계로 요약한다. */
function figmaAccessStep(
  status: McpStatus | null,
  registerCommand: string,
  connectHint: string,
): SetupStep {
  const base = { name: "Figma 접근" };
  if (status === "connected") return { ...base, ok: true, detail: "Figma MCP 연결됨" };
  if (figmaTokenSet()) {
    return {
      ...base,
      ok: true,
      detail:
        status === "registered"
          ? "MCP는 끊겨 있지만 Figma 토큰 REST 폴백으로 동작"
          : "Figma 토큰 REST 폴백으로 동작",
    };
  }
  if (status === "registered") {
    return {
      ...base,
      ok: false,
      detail: "figma MCP가 등록됐지만 연결이 끊겨 있음",
      hint: connectHint,
    };
  }
  if (status === "missing") {
    return {
      ...base,
      ok: false,
      detail: "figma MCP 미등록",
      hint: "아래 명령으로 등록하거나, 설정에 Figma 토큰을 입력하면 REST 폴백으로 동작합니다.",
      command: registerCommand,
    };
  }
  return { ...base, ok: null, detail: "확인 불가 (CLI 미설치 또는 시간 초과)" };
}

async function claudeSetup(): Promise<BackendSetup> {
  const cli = await cliVersion(CLAUDE_BIN());
  // claude mcp list는 등록된 모든 서버에 헬스체크를 돌린다 — 넉넉한 타임아웃.
  const list = cli.ok ? await mcpList(CLAUDE_BIN(), 45_000) : null;
  const mcp = list === null ? null : figmaMcpFromClaudeList(list);

  // 스킬은 레포에 벤더링됨 (skills/figma-edm) — clone만으로 있어야 정상.
  const skillDir = path.join(process.cwd(), "skills", "figma-edm");
  const skillOk = existsSync(path.join(skillDir, "SKILL.md"));

  const steps: SetupStep[] = [
    {
      name: "CLI 설치",
      ok: cli.ok,
      detail: cli.detail,
      hint: cli.ok
        ? undefined
        : "아래 명령을 복사해 터미널에 붙여넣어 설치한 뒤, `claude`를 한 번 실행해 로그인하세요 (https://claude.com/claude-code).",
      // 기본 백엔드의 첫 단계다 — 여기서 명령을 못 주면 팀원이 문서를 뒤져야 한다.
      command: cli.ok
        ? undefined
        : process.platform === "win32"
          ? "winget install Anthropic.ClaudeCode"
          : "curl -fsSL https://claude.ai/install.sh | bash",
    },
    figmaAccessStep(
      mcp,
      "claude mcp add --transport http figma https://mcp.figma.com/mcp",
      "`claude` 대화에서 claude.ai Figma 커넥터를 다시 연결·로그인하세요.",
    ),
    {
      name: "figma-edm 스킬",
      ok: skillOk,
      detail: skillOk ? skillDir : "skills/figma-edm 없음",
      command: skillOk ? undefined : "git checkout -- skills/figma-edm",
    },
  ];
  return finish("claude-code", steps);
}

async function geminiSetup(): Promise<BackendSetup> {
  const cli = await cliVersion(GEMINI_BIN());
  const keyOk = Boolean(getSettings().geminiApiKey || process.env.GEMINI_API_KEY);
  const list = cli.ok ? await mcpList(GEMINI_BIN(), 20_000) : null;
  const mcp = list === null ? null : figmaMcpFromGeminiList(list);

  const steps: SetupStep[] = [
    {
      name: "CLI 설치",
      ok: cli.ok,
      detail: cli.ok ? `v${cli.detail}` : "미설치",
      command: cli.ok ? undefined : "npm i -g @google/gemini-cli",
    },
    {
      name: "API 키",
      ok: keyOk,
      detail: keyOk ? "설정됨" : "미설정",
      hint: keyOk
        ? undefined
        : "aistudio.google.com/apikey 에서 키를 발급해 아래 입력란에 저장하세요 (무료 로그인 티어는 중단됨).",
    },
    figmaAccessStep(
      mcp,
      "gemini mcp add --transport http figma https://mcp.figma.com/mcp",
      "터미널에서 `gemini` 실행 후 /mcp 로 figma 재인증 — 또는 설정에 Figma 토큰을 입력하면 REST 폴백으로 동작합니다.",
    ),
  ];
  return finish("gemini", steps);
}

async function codexSetup(): Promise<BackendSetup> {
  const cli = await cliVersion(CODEX_BIN());
  let login: SetupStep;
  if (!cli.ok) {
    login = { name: "로그인", ok: null, detail: "CLI 설치 후 확인 가능" };
  } else {
    try {
      const { stdout, stderr } = await execFileAsync(CODEX_BIN(), ["login", "status"], {
        timeout: 10_000,
      });
      login = {
        name: "로그인",
        ok: true,
        detail: (stdout.trim() || stderr.trim()).split("\n")[0] || "로그인됨",
      };
    } catch {
      login = { name: "로그인", ok: false, detail: "로그인 필요", command: "codex login" };
    }
  }
  const list = cli.ok ? await mcpList(CODEX_BIN(), 20_000) : null;
  const mcp = list === null ? null : figmaMcpFromCodexList(list);

  const steps: SetupStep[] = [
    {
      name: "CLI 설치",
      ok: cli.ok,
      detail: cli.ok ? cli.detail : "미설치",
      command: cli.ok ? undefined : "npm i -g @openai/codex",
    },
    login,
    figmaAccessStep(
      mcp,
      "codex mcp add figma --url https://mcp.figma.com/mcp",
      "`codex mcp add figma --url https://mcp.figma.com/mcp` 재등록(브라우저 OAuth) — 또는 설정에 Figma 토큰 입력.",
    ),
  ];
  return finish("codex", steps);
}

function finish(id: string, steps: SetupStep[]): BackendSetup {
  return {
    id,
    label: listProviders().find((p) => p.id === id)?.label ?? id,
    ready: steps.every((s) => s.ok !== false),
    steps,
  };
}

const CACHE_MS = 5 * 60_000;
const g = globalThis as unknown as {
  __mhmSetup?: { at: number; backends: BackendSetup[] };
  __mhmSetupInFlight?: Promise<BackendSetup[]>;
  __mhmSetupTests?: Map<string, Promise<BackendTestResult>>;
};

export async function getBackendSetup(force = false): Promise<BackendSetup[]> {
  const cached = g.__mhmSetup;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.backends;
  // 동시 요청은 진행 중인 점검 하나에 합류한다 (mcp list가 수 초~수십 초 걸림).
  if (!force && g.__mhmSetupInFlight) return g.__mhmSetupInFlight;

  const run = (async () => {
    const backends = [
      ...(await Promise.all([claudeSetup(), geminiSetup(), codexSetup()])),
      finish("mock", [
        { name: "준비", ok: true, detail: "항상 사용 가능 — 토큰 소모 없이 UI 플로우 확인" },
      ]),
    ];
    g.__mhmSetup = { at: Date.now(), backends };
    return backends;
  })();
  g.__mhmSetupInFlight = run;
  try {
    return await run;
  } finally {
    g.__mhmSetupInFlight = undefined;
  }
}

// ---------------------------------------------------------------------------
// 연동 테스트 — 실제 CLI를 초소형 프롬프트로 스폰해 왕복을 확인한다.
// (10분짜리 실제 변환을 돌리지 않고도 "진짜 동작함"을 확정하는 용도)
// ---------------------------------------------------------------------------

export interface BackendTestResult {
  ok: boolean;
  summary: string;
  ms: number;
}

const TEST_PROMPT =
  'This is a connectivity check. Reply with exactly "READY" and nothing else. Do not use any tools.';

export async function runBackendTest(id: string): Promise<BackendTestResult> {
  // 같은 백엔드의 테스트가 이미 도는 중이면 합류한다 (중복 스폰 방지).
  const tests = (g.__mhmSetupTests ??= new Map());
  const inFlight = tests.get(id);
  if (inFlight) return inFlight;

  const run = (async (): Promise<BackendTestResult> => {
    const provider = getProvider(id); // 알 수 없는 id는 여기서 throw
    const workDir = await mkdtemp(path.join(os.tmpdir(), "mhm-setup-test-"));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    const started = Date.now();
    try {
      const result = await provider.run(
        {
          jobId: "setup-test",
          figmaUrl: "https://www.figma.com/design/x/y",
          workDir,
          promptOverride: TEST_PROMPT,
        },
        () => {},
        ac.signal,
      );
      const timedOut = ac.signal.aborted;
      return {
        ok: result.ok && !timedOut,
        summary: timedOut ? "2분 안에 응답이 없어 중단했습니다." : result.summary.slice(0, 500),
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      void rm(workDir, { recursive: true, force: true });
    }
  })();
  tests.set(id, run);
  try {
    return await run;
  } finally {
    tests.delete(id);
  }
}

// ---------------------------------------------------------------------------
// 키 저장 시 즉시 검증 — 오타를 잡 실패가 아니라 저장 시점에 잡는다.
// ---------------------------------------------------------------------------

export type KeyCheck = "ok" | "invalid" | "network";

export async function validateFigmaToken(token: string): Promise<KeyCheck> {
  try {
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-FIGMA-TOKEN": token },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "invalid" : "network";
  } catch {
    return "network";
  }
}

export async function validateGeminiKey(key: string): Promise<KeyCheck> {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (res.ok) return "ok";
    return res.status === 400 || res.status === 401 || res.status === 403 ? "invalid" : "network";
  } catch {
    return "network";
  }
}
