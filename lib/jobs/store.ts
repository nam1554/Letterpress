import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "../providers/types";
import type { VerifySummary } from "./acceptance";
import { liveControllers } from "./live";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  figmaUrl: string;
  /** 사람이 알아볼 이름 — Figma URL의 파일명 슬러그에서 추출. */
  title?: string;
  provider: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  summary?: string;
  /** 픽셀 검증 요약 (workDir/verify.json) — 완료 시 러너가 기록. */
  verify?: VerifySummary;
  /** 부분 수정 잡의 원본 잡 id — workDir는 원본의 복사본. */
  editOf?: string;
  /** 부분 수정 지시문 (editOf와 함께 설정됨). */
  instruction?: string;
}

export interface Artifact {
  /** Path relative to the job's output dir, e.g. "images/logo.png". */
  rel: string;
  size: number;
}

// Env override exists for tests (vitest sets a tmp dir).
const dataDir = () => process.env.MHM_DATA_DIR ?? path.join(process.cwd(), "data", "jobs");

// Survive Next dev HMR module reloads: keep live state on globalThis.
type Listener = (e: AgentEvent) => void;
interface JobsGlobal {
  listeners: Map<string, Set<Listener>>;
  /** 진행 중인 reconcile — 동시 읽기가 결과를 함께 기다린다. */
  reconciling: Map<string, Promise<Job>>;
  /** 잡별 다음 이벤트 시퀀스 (프로세스 시작 시 파일 라인 수로 초기화). */
  seqs: Map<string, number>;
}
const g = globalThis as unknown as { __jobsGlobal?: JobsGlobal };
const live: JobsGlobal = (g.__jobsGlobal ??= {
  listeners: new Map(),
  reconciling: new Map(),
  seqs: new Map(),
});
// fields added (or reshaped) after first deploys of this global — HMR keeps the
// old object, so check the shape rather than only the presence.
if (!(live.reconciling instanceof Map)) live.reconciling = new Map();
live.seqs ??= new Map();

// Job ids are 8-char hex from createJob. Anything else (e.g. an URL-encoded
// "../" smuggled into a route param) must never reach a filesystem path.
const VALID_ID = /^[0-9a-f]{8}$/;

export const jobDir = (id: string) => {
  if (!VALID_ID.test(id)) throw new Error(`invalid job id: ${JSON.stringify(id)}`);
  return path.join(dataDir(), id);
};
export const workDir = (id: string) => path.join(jobDir(id), "work");
export const outputDir = (id: string) => path.join(workDir(id), "output");
const jobFile = (id: string) => path.join(jobDir(id), "job.json");
const eventsFile = (id: string) => path.join(jobDir(id), "events.ndjson");

async function persist(job: Job): Promise<void> {
  // Atomic write: a reader must never see a half-written job.json.
  // Unique tmp name: concurrent writers must not rename each other's file away.
  const tmp = `${jobFile(job.id)}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, jobFile(job.id));
}

/**
 * 아직 쓰이지 않은 잡 id. 8자리 16진수는 충돌 확률이 낮지만, 충돌하면
 * createJob이 기존 잡 디렉터리 위에 그대로 덮어써 조용히 데이터가 사라진다.
 */
export function reserveJobId(generate: () => string = () => randomUUID().slice(0, 8)): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = generate();
    if (!existsSync(jobDir(id))) return id;
  }
  throw new Error("사용 가능한 작업 id를 찾지 못했습니다.");
}

export async function createJob(
  figmaUrl: string,
  provider: string,
  title?: string,
): Promise<Job> {
  const job: Job = {
    id: reserveJobId(),
    figmaUrl,
    title,
    provider,
    status: "queued",
    createdAt: Date.now(),
  };
  await mkdir(outputDir(job.id), { recursive: true });
  await persist(job);
  return job;
}

/**
 * 부분 수정 잡 — 원본 잡의 work/ 전체(빌드 스크립트·에셋·검증 증거물 포함)를
 * 새 잡으로 복사해, 에이전트가 처음부터가 아니라 기존 빌드 위에서 지시된
 * 변경만 적용하게 한다. 원본 잡은 그대로 보존된다.
 */
export async function createEditJob(source: Job, instruction: string): Promise<Job> {
  const job: Job = {
    id: reserveJobId(),
    figmaUrl: source.figmaUrl,
    title: source.title ? `${source.title} · 수정` : "부분 수정",
    provider: source.provider,
    status: "queued",
    createdAt: Date.now(),
    editOf: source.id,
    instruction,
  };
  await mkdir(jobDir(job.id), { recursive: true });
  await cp(workDir(source.id), workDir(job.id), { recursive: true });
  await persist(job);
  return job;
}

// A job created this recently may not have registered its controller yet.
export const STALE_GRACE_MS = 10_000;

/**
 * The runner lives in this process; after a server restart a job persisted as
 * queued/running can never finish. Detect that (no live controller) and mark
 * it failed so the UI and SSE streams terminate instead of hanging forever.
 */
async function reconcile(job: Job): Promise<Job> {
  const active = job.status === "queued" || job.status === "running";
  if (!active || liveControllers.has(job.id)) return job;
  if (Date.now() - job.createdAt < STALE_GRACE_MS) return job;
  // Concurrent reads must not each persist + append a duplicate error event.
  // 진행 중인 reconcile이 있으면 그 결과를 함께 기다린다 — 낡은 "실행 중"을
  // 돌려주면 그 요청을 띄운 화면이 이미 실패한 잡을 실행 중으로 표시한다.
  const inflight = live.reconciling.get(job.id);
  if (inflight) return inflight;

  const run = (async (): Promise<Job> => {
    const failed: Job = {
      ...job,
      status: "failed",
      finishedAt: Date.now(),
      summary: "서버가 재시작되어 실행이 중단되었습니다. 다시 실행해 주세요.",
    };
    await persist(failed);
    appendEvent(job.id, {
      ts: Date.now(),
      type: "error",
      text: "실패: 서버가 재시작되어 실행이 중단되었습니다.",
    });
    return failed;
  })();
  // 끝나면 반드시 비운다 — 남겨두면 그 잡은 이 프로세스에서 다시는 reconcile
  // 되지 않고, 항목이 계속 쌓인다.
  live.reconciling.set(
    job.id,
    run.finally(() => live.reconciling.delete(job.id)),
  );
  return run;
}

export async function getJob(id: string): Promise<Job | null> {
  try {
    const job = JSON.parse(await readFile(jobFile(id), "utf8")) as Job;
    return await reconcile(job);
  } catch {
    return null;
  }
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  const next = { ...job, ...patch };
  await persist(next);
  return next;
}

export async function listJobs(): Promise<Job[]> {
  if (!existsSync(dataDir())) return [];
  const ids = await readdir(dataDir());
  const jobs = await Promise.all(ids.map(getJob));
  return jobs
    .filter((j): j is Job => j !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// One runaway tool-output line must not bloat events.ndjson and every SSE client.
const MAX_EVENT_TEXT = 4000;

function nextSeq(id: string): number {
  let current = live.seqs.get(id);
  if (current === undefined) {
    // 프로세스 재시작 후 첫 append: 기존 파일 라인 수에서 이어간다.
    try {
      current = readFileSync(eventsFile(id), "utf8").split("\n").filter(Boolean).length;
    } catch {
      current = 0;
    }
  }
  const next = current + 1;
  live.seqs.set(id, next);
  return next;
}

export function appendEvent(id: string, event: AgentEvent): void {
  const bounded: AgentEvent = {
    ...event,
    seq: nextSeq(id),
    text:
      event.text.length > MAX_EVENT_TEXT
        ? `${event.text.slice(0, MAX_EVENT_TEXT)}… (truncated)`
        : event.text,
  };
  // 로깅은 최선 노력이다 — 디스크 오류나 삭제된 잡 디렉터리 때문에 실행 중인
  // 잡이 죽어서는 안 된다.
  try {
    // Sync append keeps event order stable relative to subscriber notification.
    appendFileSync(eventsFile(id), `${JSON.stringify(bounded)}\n`);
  } catch {
    /* 이벤트 한 줄을 잃는 편이 잡을 잃는 것보다 낫다. */
  }
  // 복사본을 돌린다: 한 구독자(닫힌 SSE 스트림 등)의 예외나 구독 해제가 다른
  // 구독자에게 전파되면 안 된다.
  for (const listener of [...(live.listeners.get(id) ?? [])]) {
    try {
      listener(bounded);
    } catch {
      /* 이 구독자만 건너뛴다. */
    }
  }
}

export async function readEvents(id: string): Promise<AgentEvent[]> {
  let raw: string;
  try {
    raw = await readFile(eventsFile(id), "utf8");
  } catch {
    return [];
  }
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // 프로세스가 append 도중 죽으면 마지막 줄이 잘린다. 그 한 줄 때문에 잡의
    // 로그 전체(UI 표시 + SSE 리플레이)를 잃어서는 안 된다.
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      /* 깨진 줄만 건너뛴다. */
    }
  }
  return events;
}

export function subscribe(id: string, listener: Listener): () => void {
  let set = live.listeners.get(id);
  if (!set) {
    set = new Set();
    live.listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) live.listeners.delete(id);
  };
}

/** 현재 구독자 수 — 스트림이 정리를 빠뜨렸는지 테스트에서 관찰한다. */
export function subscriberCount(id: string): number {
  return live.listeners.get(id)?.size ?? 0;
}

export async function listArtifacts(id: string): Promise<Artifact[]> {
  const base = outputDir(id);
  if (!existsSync(base)) return [];
  const out: Artifact[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const { size } = await stat(full);
        out.push({ rel: path.relative(base, full), size });
      }
    }
  }
  await walk(base);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Resolve an artifact file path safely inside the job's output dir. */
export function resolveArtifact(id: string, rel: string): string | null {
  let base: string;
  try {
    base = outputDir(id);
  } catch {
    return null;
  }
  const full = path.resolve(base, rel);
  // Must be strictly inside output/ — the dir itself is not a servable file.
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

/** Delete a job and all its data. Refuses while the job is still executing. */
export async function deleteJob(id: string): Promise<boolean> {
  if (liveControllers.has(id)) return false;
  await rm(jobDir(id), { recursive: true, force: true });
  live.reconciling.delete(id);
  live.listeners.delete(id);
  live.seqs.delete(id);
  dirSizeCache.delete(id);
  return true;
}

const TERMINAL_FOR_SIZE = new Set<JobStatus>(["succeeded", "failed"]);
/**
 * 잡별 디스크 사용량 캐시. 상태를 함께 담아 두므로 이어서 실행·부분 수정으로
 * 잡이 running으로 돌아왔다가 다시 끝나면 자동으로 다시 잰다. 실행 중인 잡은
 * 짧은 TTL로만 캐시한다 — 홈 화면이 5초마다 폴링하는데 매번 work/ 트리 전체를
 * 재귀 탐색하면 SSE 로그 스트림·다운로드와 같은 이벤트 루프를 잡아먹는다.
 */
const dirSizeCache = new Map<string, { bytes: number; at: number; status: JobStatus }>();
const RUNNING_SIZE_TTL_MS = 30_000;

/** 잡 디렉터리를 밖에서 건드렸을 때(예: hosted/ 생성) 캐시를 버린다. */
export function invalidateJobSize(id: string): void {
  dirSizeCache.delete(id);
}

async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // 디렉터리 없음/권한 오류 — 크기는 부가 정보라 0으로
  }
  let sum = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += await dirSize(p);
    else if (e.isFile()) sum += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return sum;
}

/** 잡 디렉터리 총 바이트. 종료 잡은 계속, 실행 중 잡은 짧게 캐시한다. */
export async function jobDirSize(job: Pick<Job, "id" | "status">): Promise<number> {
  const terminal = TERMINAL_FOR_SIZE.has(job.status);
  const cached = dirSizeCache.get(job.id);
  if (
    cached &&
    cached.status === job.status &&
    (terminal || Date.now() - cached.at < RUNNING_SIZE_TTL_MS)
  ) {
    return cached.bytes;
  }
  const bytes = await dirSize(jobDir(job.id));
  dirSizeCache.set(job.id, { bytes, at: Date.now(), status: job.status });
  return bytes;
}
