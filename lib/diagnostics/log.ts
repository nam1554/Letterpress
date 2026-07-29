import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 서버에서 터진 문제를 파일로 남긴다.
 *
 * 지금까지 잡 관련 사건은 `events.ndjson`에 남았지만, 라우트가 500을 내거나
 * 처리되지 않은 예외로 죽는 일은 터미널 창에만 찍히고 창을 닫으면 사라졌다.
 * 비개발자가 "뭐가 잘못됐는지" 전달할 방법이 없어지는 지점이 여기다.
 */

const MAX_BYTES = 1_000_000; // 넘으면 .1로 밀어내고 새로 쓴다 (보관은 2세대)

export function logsDir(): string {
  if (process.env.MHM_LOG_DIR) return process.env.MHM_LOG_DIR;
  const jobs = process.env.MHM_DATA_DIR ?? path.join(process.cwd(), "data", "jobs");
  return path.join(path.dirname(jobs), "logs");
}

export const logFile = () => path.join(logsDir(), "app.log");

export interface Problem {
  /** 어디서 온 문제인지 (route / uncaught / unhandled-rejection …). */
  source: string;
  message: string;
  /** 스택이나 추가 맥락. */
  detail?: string;
}

/**
 * 한 줄 추가. 로깅 실패가 앱을 죽이면 안 되므로 전부 삼킨다
 * (appendEvent와 같은 최선 노력 원칙).
 */
export function logProblem(problem: Problem): void {
  try {
    const dir = logsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = logFile();
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      renameSync(file, `${file}.1`);
    }
    const detail = problem.detail ? `\n${problem.detail}` : "";
    appendFileSync(
      file,
      `${new Date().toISOString()} [${problem.source}] ${problem.message}${detail}\n`,
      "utf8",
    );
  } catch {
    /* 로그를 못 남기는 것이 앱을 멈출 이유는 아니다 */
  }
}

/** 진단 번들에 실을 최근 로그 (뒤에서부터 최대 byte 수). */
export function readRecentLog(maxBytes = 300_000): string {
  let out = "";
  for (const file of [`${logFile()}.1`, logFile()]) {
    try {
      if (existsSync(file)) out += readFileSync(file, "utf8");
    } catch {
      /* 못 읽으면 건너뛴다 */
    }
  }
  return out.length > maxBytes ? out.slice(-maxBytes) : out;
}
