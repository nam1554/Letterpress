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
  /**
   * claude CLI에 --model로 넘길 모델 (예: "haiku"). 빈 값 = CLI 기본.
   * 검증 없이 저장 — 잘못된 값은 CLI가 즉시 에러를 내 잡 실패로 표시된다.
   */
  claudeModel: string;
  /** 잡 종료 시 macOS 알림센터 알림 (darwin 전용, 기본 켬). */
  notifyOnFinish: boolean;
}

const file = () =>
  process.env.MHM_SETTINGS_FILE ?? path.join(process.cwd(), "data", "settings.json");

interface Stored {
  defaultProvider?: string;
  maxConcurrentJobs?: number;
  jobTimeoutMinutes?: number;
  figmaToken?: string;
  cdnTemplate?: string;
  claudeModel?: string;
  notifyOnFinish?: boolean;
}

/**
 * 손상된 원본을 옆으로 치운다. **이미 있는 백업을 덮지 않는다** — 두 번째
 * 손상이 첫 백업을 지우면, 사용자가 아직 꺼내지 않은 토큰이 영영 사라진다.
 */
function backupCorrupt(): void {
  const src = file();
  const first = `${src}.corrupt`;
  const dest = existsSync(first) ? `${first}.${Date.now()}` : first;
  try {
    renameSync(src, dest);
  } catch {
    /* 옮기지 못해도 기본값으로 계속 간다 (최선 노력) */
  }
}

/**
 * 저장된 설정과 "원본을 신뢰할 수 있는가".
 *
 * `unreadable`은 **파일이 있는데 읽지 못한 상태**다(EACCES·EMFILE 등).
 * 이때 patch만 써 버리면 멀쩡한 원본이 그 한 필드로 덮인다 — rename은 디렉터리
 * 권한만 있으면 성공하므로 읽기 권한이 없어도 덮어쓰기는 된다(리뷰 실측).
 * 그래서 읽기 실패는 조용히 기본값으로 넘기되 **저장은 거부**한다.
 * 파일이 아예 없는 것(ENOENT)은 첫 실행이라 정상 경로다.
 */
function readStored(): { data: Stored; unreadable: boolean } {
  let raw: string;
  try {
    raw = readFileSync(file(), "utf8");
  } catch (err) {
    const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
    return { data: {}, unreadable: !enoent };
  }
  try {
    return { data: JSON.parse(raw) as Stored, unreadable: false };
  } catch {
    // 파일은 있는데 파싱이 안 된다 = 손상. 그대로 두면 다음 저장이 patch만
    // 남기고 기존 설정(Figma 토큰·CDN 템플릿)을 통째로 덮어써 **조용히**
    // 지운다(실측 2026-08-08). 원본을 옆으로 치워 두면 저장은 정상 진행되고
    // 사용자는 값을 되찾을 수 있다.
    backupCorrupt();
    return { data: {}, unreadable: false };
  }
}

function stored(): Stored {
  return readStored().data;
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
    claudeModel: s.claudeModel ?? process.env.CLAUDE_MODEL ?? "",
    notifyOnFinish: s.notifyOnFinish ?? true,
  };
}

export function saveSettings(patch: Partial<Stored>): Settings {
  const { data, unreadable } = readStored();
  // 원본을 못 읽는 상태에서 쓰면 patch 한 필드로 멀쩡한 설정을 덮는다.
  // 저장을 막아 원본을 지키고, 사용자에게는 라우트가 오류로 알린다.
  if (unreadable) {
    throw new Error(
      "설정 파일을 읽을 수 없어 저장을 중단했습니다 — 덮어쓰면 기존 설정이 사라집니다. data/settings.json의 권한을 확인해 주세요.",
    );
  }
  const next: Stored = { ...data };
  if (patch.defaultProvider !== undefined) next.defaultProvider = patch.defaultProvider;
  if (patch.maxConcurrentJobs !== undefined) {
    next.maxConcurrentJobs = intOr(patch.maxConcurrentJobs, 2);
  }
  if (patch.jobTimeoutMinutes !== undefined) {
    next.jobTimeoutMinutes = intOr(patch.jobTimeoutMinutes, 45);
  }
  if (patch.figmaToken !== undefined) next.figmaToken = patch.figmaToken.trim();
  if (patch.cdnTemplate !== undefined) next.cdnTemplate = patch.cdnTemplate.trim();
  if (patch.claudeModel !== undefined) next.claudeModel = patch.claudeModel.trim();
  if (patch.notifyOnFinish !== undefined) next.notifyOnFinish = patch.notifyOnFinish;

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
