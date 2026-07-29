import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * User-facing settings, editable from the home screen. Stored in
 * data/settings.json. Precedence: settings.json > environment variable >
 * built-in default — env vars remain as an advanced override for scripts.
 */
export interface Settings {
  defaultProvider: string;
  maxConcurrentJobs: number;
  jobTimeoutMinutes: number;
  figmaToken: string;
  /** CDN 교체본 URL 템플릿 ({file}/{name}/{ext}) — 팀에서 재사용. */
  cdnTemplate: string;
  /** Gemini API 키 — 무료 Code Assist 티어 중단(2026-07 확인) 이후의 인증 경로. */
  geminiApiKey: string;
}

const file = () =>
  process.env.MHM_SETTINGS_FILE ?? path.join(process.cwd(), "data", "settings.json");

interface Stored {
  defaultProvider?: string;
  maxConcurrentJobs?: number;
  jobTimeoutMinutes?: number;
  figmaToken?: string;
  cdnTemplate?: string;
  geminiApiKey?: string;
}

function stored(): Stored {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Stored;
  } catch {
    return {};
  }
}

const intOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function getSettings(): Settings {
  const s = stored();
  return {
    defaultProvider: s.defaultProvider ?? process.env.AGENT_PROVIDER ?? "claude-code",
    maxConcurrentJobs: intOr(s.maxConcurrentJobs ?? process.env.MAX_CONCURRENT_JOBS, 2),
    jobTimeoutMinutes: intOr(
      s.jobTimeoutMinutes ?? Number(process.env.JOB_TIMEOUT_MS) / 60_000,
      45,
    ),
    figmaToken: s.figmaToken ?? process.env.FIGMA_TOKEN ?? "",
    cdnTemplate: s.cdnTemplate ?? "",
    geminiApiKey: s.geminiApiKey ?? process.env.GEMINI_API_KEY ?? "",
  };
}

export function saveSettings(patch: Partial<Stored>): Settings {
  const next: Stored = { ...stored() };
  if (patch.defaultProvider !== undefined) next.defaultProvider = patch.defaultProvider;
  if (patch.maxConcurrentJobs !== undefined) {
    next.maxConcurrentJobs = intOr(patch.maxConcurrentJobs, 2);
  }
  if (patch.jobTimeoutMinutes !== undefined) {
    next.jobTimeoutMinutes = intOr(patch.jobTimeoutMinutes, 45);
  }
  if (patch.figmaToken !== undefined) next.figmaToken = patch.figmaToken.trim();
  if (patch.cdnTemplate !== undefined) next.cdnTemplate = patch.cdnTemplate.trim();
  if (patch.geminiApiKey !== undefined) next.geminiApiKey = patch.geminiApiKey.trim();

  mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${randomUUID().slice(0, 8)}.tmp`;
  // Figma 토큰이 평문으로 저장되는 파일 — 소유자만 읽게 한다.
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
  return getSettings();
}

export function settingsFileExists(): boolean {
  return existsSync(file());
}
