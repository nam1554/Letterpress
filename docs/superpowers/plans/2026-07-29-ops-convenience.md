# 운영 편의 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 잡 디스크 사용량 표시 · 체크박스 선택 삭제 · 완료 시 macOS 알림 · 잡 목록 상태 필터/검색.

**Architecture:** 서버는 3곳만 확장한다 — `store.ts`에 크기 계산(종료 잡 캐시), 새 `bulk-delete` 라우트(기존 `deleteJob` 재사용), `runner.ts` 종료 지점에서 best-effort osascript 알림. UI는 `app/page.tsx`의 기존 잡 목록에 얹는다. 필터/검색은 클라이언트 측만.

**Tech Stack:** Next.js(App Router) · zod(`readBody`) · vitest · Mantine v9 · SWR.

## Global Constraints

- 알림·크기 계산 실패가 잡 상태/응답을 깨뜨리면 안 된다 (`appendEvent`와 같은 최선 노력 원칙).
- 클라이언트 mutation은 `app/lib/request.ts`의 `sendJson`만 사용 (bare fetch 금지).
- 브라우저 `confirm()` 등 모달 다이얼로그 금지 (자동화 차단).
- UI는 `app/theme.ts` 토큰 사용, 테마 분기 금지.
- 스펙: `docs/superpowers/specs/2026-07-29-ops-convenience-design.md`

---

### Task 1: `jobDirSize` — 잡 디렉터리 크기 + 종료 잡 캐시

**Files:**
- Modify: `lib/jobs/store.ts` (jobDir/deleteJob 근처)
- Test: `lib/jobs/store.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Produces: `jobDirSize(job: Job): Promise<number>` — 잡 디렉터리 재귀 바이트 합. 종료 상태(`succeeded|failed|cancelled|timeout`)면 모듈 캐시 사용. `deleteJob`이 캐시를 지운다.

- [ ] **Step 1: 실패하는 테스트 작성** — `store.test.ts`에 추가:

```ts
describe("jobDirSize", () => {
  it("sums the job directory and caches only terminal jobs", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await writeFile(path.join(workDir(job.id), "a.bin"), Buffer.alloc(1000));
    const running = await jobDirSize(job); // status: queued → 캐시 안 됨
    await writeFile(path.join(workDir(job.id), "b.bin"), Buffer.alloc(500));
    expect(await jobDirSize(job)).toBe(running + 500);

    const done = { ...job, status: "succeeded" as const };
    const cached = await jobDirSize(done); // 종료 → 캐시
    await writeFile(path.join(workDir(job.id), "c.bin"), Buffer.alloc(9999));
    expect(await jobDirSize(done)).toBe(cached); // 캐시 적중: 파일 추가 무시
  });

  it("invalidates the cache on deleteJob", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const done = { ...job, status: "failed" as const };
    await jobDirSize(done);
    await deleteJob(job.id);
    const again = await createJob("https://www.figma.com/design/abc/", "mock");
    // 다른 id라 자연히 미스지만, 같은 id 재사용 시 낡은 값이 남으면 안 된다는 계약을
    // 캐시 직접 확인으로 고정: 삭제된 id로 다시 재면 0 (디렉터리 없음)
    expect(await jobDirSize({ ...done })).toBe(0);
    await deleteJob(again.id);
  });
});
```

(import에 `jobDirSize` 추가. `writeFile`/`path`는 파일 상단에 이미 있다.)

- [ ] **Step 2: 실패 확인** — `pnpm vitest run lib/jobs/store.test.ts` → "jobDirSize is not exported" 계열 FAIL.
- [ ] **Step 3: 구현** — `store.ts`:

```ts
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timeout"]);
const dirSizeCache = new Map<string, number>();

async function dirSize(dir: string): Promise<number> {
  let sum = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // 디렉터리 없음/권한 오류 — 크기는 부가 정보라 0으로
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += await dirSize(p);
    else if (e.isFile()) sum += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return sum;
}

/** 잡 디렉터리 총 바이트. 종료 잡은 캐시(파일이 더 변하지 않는다). */
export async function jobDirSize(job: Job): Promise<number> {
  const terminal = TERMINAL.has(job.status);
  if (terminal && dirSizeCache.has(job.id)) return dirSizeCache.get(job.id)!;
  const size = await dirSize(jobDir(job.id));
  if (terminal) dirSizeCache.set(job.id, size);
  return size;
}
```

`deleteJob` 본문에 `dirSizeCache.delete(id);` 한 줄 추가. (`stat` import 확인.)

- [ ] **Step 4: 통과 확인** — `pnpm vitest run lib/jobs/store.test.ts` → PASS.
- [ ] **Step 5: 커밋** — `git add lib/jobs/store.ts lib/jobs/store.test.ts && git commit -m "feat: jobDirSize — 잡 디스크 사용량 (종료 잡 캐시)"`

---

### Task 2: `GET /api/jobs`에 `diskBytes` 추가

**Files:**
- Modify: `app/api/jobs/route.ts:12-18` (GET)
- Test: `app/api/jobs/routes.test.ts` (기존 파일)

**Interfaces:**
- Consumes: `jobDirSize(job)` (Task 1)
- Produces: GET 응답 `jobs: Array<Job & {diskBytes: number}>` — UI(Task 5)가 읽는다.

- [ ] **Step 1: 실패하는 테스트** — routes.test.ts의 GET describe에:

```ts
it("includes per-job diskBytes", async () => {
  const job = await createJob("https://www.figma.com/design/abc/", "mock");
  await writeFile(path.join(workDir(job.id), "blob.bin"), Buffer.alloc(2048));
  const res = await GET();
  const body = await res.json();
  const row = body.jobs.find((j: { id: string }) => j.id === job.id);
  expect(row.diskBytes).toBeGreaterThanOrEqual(2048);
});
```

- [ ] **Step 2: 실패 확인** — `pnpm vitest run app/api/jobs/routes.test.ts` → diskBytes undefined FAIL.
- [ ] **Step 3: 구현** — GET을:

```ts
export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({
    jobs: await Promise.all(jobs.map(async (j) => ({ ...j, diskBytes: await jobDirSize(j) }))),
    providers: listProviders(),
    defaultProvider: defaultProviderId(),
  });
}
```

(import에 `jobDirSize` 추가.)

- [ ] **Step 4: 통과 확인** → PASS. **Step 5: 커밋** — `feat: 잡 목록 API에 diskBytes`

---

### Task 3: `POST /api/jobs/bulk-delete`

**Files:**
- Create: `app/api/jobs/bulk-delete/route.ts`
- Test: `app/api/jobs/routes.test.ts`

**Interfaces:**
- Consumes: `deleteJob(id)` (기존 — 실행 중 잡이면 false 반환), `readBody`
- Produces: `POST {ids: string[]}` → `{results: [{id, ok, error?}]}` — UI(Task 5)가 호출.

- [ ] **Step 1: 실패하는 테스트**:

```ts
describe("POST /api/jobs/bulk-delete", () => {
  it("rejects an empty or malformed body", async () => {
    const { POST: BULK } = await import("./bulk-delete/route");
    const res = await BULK(reqJson({ ids: [] })); // reqJson: 기존 테스트 헬퍼 사용
    expect(res.status).toBe(400);
  });

  it("deletes deletable jobs and reports running ones as failed", async () => {
    const { POST: BULK } = await import("./bulk-delete/route");
    const done = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(done.id, { status: "failed" });
    const res = await BULK(reqJson({ ids: [done.id, "00000000"] }));
    const { results } = await res.json();
    expect(results).toEqual([
      { id: done.id, ok: true },
      { id: "00000000", ok: false, error: expect.any(String) },
    ]);
    expect(existsSync(workDir(done.id))).toBe(false);
  });
});
```

(기존 routes.test.ts의 Request 생성 패턴을 그대로 따른다 — 헬퍼 이름이 다르면 그 파일 것을 사용.)

- [ ] **Step 2: 실패 확인** — 모듈 없음 FAIL.
- [ ] **Step 3: 구현** — `app/api/jobs/bulk-delete/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { deleteJob } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const body = z.object({ ids: z.array(z.string()).min(1).max(200) });

/** 선택 삭제 — 잡별 성공/거부를 개별 반환해 부분 실패가 전체를 막지 않는다. */
export async function POST(req: NextRequest) {
  const r = await readBody(req, body);
  if (!r.ok) return r.res;
  const results = [];
  for (const id of r.data.ids) {
    const ok = await deleteJob(id);
    results.push(ok ? { id, ok } : { id, ok, error: "삭제할 수 없습니다 (실행 중이거나 없는 잡)" });
  }
  return NextResponse.json({ results });
}
```

(주의: `deleteJob`의 실제 반환/예외 계약을 확인하고 맞출 것 — 존재하지 않는 id·실행 중 잡 모두 false를 돌려주는지. 다르면 try/catch로 감싼다.)

- [ ] **Step 4: 통과 확인** → PASS. **Step 5: 커밋** — `feat: 선택 삭제 API (bulk-delete)`

---

### Task 4: 완료 시 macOS 알림

**Files:**
- Create: `lib/jobs/notify.ts` · Test: `lib/jobs/notify.test.ts`
- Modify: `lib/settings.ts` (`notifyOnFinish` — Settings/Stored/getSettings 기본 true/saveSettings)
- Modify: `app/api/settings/route.ts` (스키마에 `notifyOnFinish: z.boolean().optional()` — 기존 패턴대로)
- Modify: `lib/jobs/runner.ts` — 종료 `updateJob` 직후(정상·catch 두 곳) `notifyJobFinished(...)` 호출

**Interfaces:**
- Produces: `notifyJobFinished(job: {id: string; status: string; title?: string}): void` — fire-and-forget, 절대 throw하지 않음.

- [ ] **Step 1: 실패하는 테스트** — `lib/jobs/notify.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn(() => ({ unref: vi.fn(), on: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

import { notifyJobFinished } from "./notify";
import { saveSettings } from "../settings";

describe("notifyJobFinished", () => {
  beforeEach(() => { spawnMock.mockClear(); saveSettings({ notifyOnFinish: true }); });

  it("spawns osascript once on finish (macOS)", () => {
    if (process.platform !== "darwin") return; // darwin 전용 경로
    notifyJobFinished({ id: "abc12345", status: "succeeded", title: "테스트 eDM" });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe("osascript");
  });

  it("does nothing when notifyOnFinish is off", () => {
    saveSettings({ notifyOnFinish: false });
    notifyJobFinished({ id: "abc12345", status: "failed" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("never throws even if spawn does", () => {
    spawnMock.mockImplementationOnce(() => { throw new Error("boom"); });
    expect(() => notifyJobFinished({ id: "abc12345", status: "failed" })).not.toThrow();
  });
});
```

(테스트는 기존 settings 테스트처럼 `MHM_SETTINGS_FILE`을 scratch로 돌리는 setup을 따른다 — `lib/setup.test.ts`/`store.test.ts`의 beforeAll 패턴 참조.)

- [ ] **Step 2: 실패 확인** → 모듈 없음 FAIL.
- [ ] **Step 3: 구현** — `lib/jobs/notify.ts`:

```ts
import { spawn } from "node:child_process";
import { getSettings } from "../settings";

/** 잡 종료를 macOS 알림센터로 — 실패는 조용히 무시(최선 노력, 잡 상태 불가침). */
export function notifyJobFinished(job: { id: string; status: string; title?: string }): void {
  try {
    if (!getSettings().notifyOnFinish || process.platform !== "darwin") return;
    const ok = job.status === "succeeded";
    const title = ok ? "Letterpress — 변환 완료" : "Letterpress — 변환 실패";
    const body = `${job.title || job.id}`;
    const p = spawn(
      "osascript",
      ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`],
      { stdio: "ignore", detached: true },
    );
    p.on("error", () => {});
    p.unref();
  } catch {
    /* 알림은 부가 기능 — 어떤 실패도 전파하지 않는다 */
  }
}
```

settings.ts: `notifyOnFinish: boolean` 추가 — `getSettings`에 `s.notifyOnFinish ?? true`, `saveSettings`에 `if (patch.notifyOnFinish !== undefined) next.notifyOnFinish = patch.notifyOnFinish;`. runner.ts: 정상 종료의 `updateJob(...)` 직후와 catch의 `updateJob(...)` 직후에 `notifyJobFinished({ id: job.id, status: ok ? "succeeded" : "failed", title: job.title });` (catch 쪽은 status "failed" 고정; `job.title` 필드명이 다르면 Job 타입의 실제 제목 필드 사용, 없으면 생략).

- [ ] **Step 4: 통과 확인** — `pnpm vitest run lib/jobs/notify.test.ts` + 전체 스위트(runner 테스트가 spawn 실경로를 타지 않는지 — darwin에서 mock 잡 종료 시 osascript가 실제 호출되면 runner.test에서 알림이 뜬다. 소음이면 runner.test setup에서 `saveSettings({notifyOnFinish:false})` 또는 `MHM_SETTINGS_FILE` scratch 기본값이 자연히 꺼진 상태인지 확인).
- [ ] **Step 5: 커밋** — `feat: 잡 종료 macOS 알림 (설정 토글, 최선 노력)`

---

### Task 5: UI — 목록 확장 (디스크·체크박스 삭제·필터/검색) + 설정 스위치

**Files:**
- Modify: `app/page.tsx` (잡 목록 — `jobs.map` 주변, `JobsResponse` 타입)
- Modify: `app/components/SettingsPanel.tsx` (notifyOnFinish Switch)
- Create: `app/lib/format.ts` (`formatBytes`)

**Interfaces:**
- Consumes: `diskBytes`(Task 2), `POST /api/jobs/bulk-delete`(Task 3), 설정 API(Task 4), `sendJson`(기존).

- [ ] **Step 1: `formatBytes`** — `app/lib/format.ts`:

```ts
/** 1234567 → "1.2MB" (한 자리 소수, 1KB 미만은 "1KB 미만"). */
export function formatBytes(n: number): string {
  if (n < 1024) return "1KB 미만";
  const units = ["KB", "MB", "GB"] as const;
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${units[u]}`;
}
```

간단 유닛 테스트를 `app/lib/format.test.ts`에 (999→"1KB 미만", 1536→"1.5KB", 12_582_912→"12.0MB").

- [ ] **Step 2: page.tsx 상태 추가** — `JobsResponse`의 잡 타입에 `diskBytes: number`; 컴포넌트에 `const [selected, setSelected] = useState<Set<string>>(new Set());` `const [statusFilter, setStatusFilter] = useState<"all"|"running"|"succeeded"|"failed">("all");` `const [query, setQuery] = useState("");`. 파생: 필터링된 목록(상태 매칭 — "running"은 queued 포함, 텍스트는 id·figmaUrl·title·summary 소문자 포함 검색), `totalBytes = jobs.reduce(...)`.
- [ ] **Step 3: 목록 헤더 UI** — 기존 목록 제목 줄에: 전체 용량 `<Text size="sm" c="dimmed">총 {formatBytes(totalBytes)}</Text>`, Mantine `SegmentedControl`(전체/실행 중/성공/실패), `TextInput`(placeholder "id·URL·요약 검색", leftSection 돋보기 없이 담백하게), 선택 조작: `<Button variant="light" size="xs" onClick={selectFailed}>실패한 잡 선택</Button>` `<Button color="red" variant="light" size="xs" disabled={selected.size===0} onClick={deleteSelected}>선택 삭제 ({selected.size})</Button>`.
- [ ] **Step 4: 행 체크박스 + 용량** — `jobs.map` 행 앞단에 `<Checkbox size="xs" disabled={job.status==="running"||job.status==="queued"} checked={selected.has(job.id)} onChange={...toggle}/>` (행 클릭 네비게이션과 이벤트 분리 — `onClick={(e)=>e.stopPropagation()}`), 행 메타 영역에 `{formatBytes(job.diskBytes)}`.
- [ ] **Step 5: deleteSelected** —

```ts
const deleteSelected = async () => {
  const r = await sendJson("/api/jobs/bulk-delete", { ids: [...selected] });
  if (!r.ok) { setError(r.error); return; } // 페이지의 기존 에러 표시 패턴 사용
  setSelected(new Set());
  mutate("/api/jobs");
  const failed = r.data.results.filter((x: {ok: boolean}) => !x.ok);
  if (failed.length > 0) setError(`${failed.length}개는 삭제하지 못했습니다 (실행 중이거나 없음)`);
};
```

(페이지의 기존 에러 상태/알림 컴포넌트 이름에 맞춘다.)

- [ ] **Step 6: SettingsPanel 스위치** — 기존 필드 패턴대로 `<Switch label="변환 완료 시 macOS 알림" checked={...notifyOnFinish} onChange={...}/>` 추가, 저장 요청 바디에 `notifyOnFinish` 포함.
- [ ] **Step 7: 검증** — `pnpm typecheck && pnpm lint && pnpm vitest run`; `pnpm dev` 띄워 mock 잡 1개 생성→종료 후: 용량 표시·체크박스 삭제·필터 칩·검색·알림(실제 osascript 배너)·설정 토글 육안 확인.
- [ ] **Step 8: 커밋** — `feat: 잡 목록 운영 UI — 디스크 표시·선택 삭제·필터·알림 설정`

---

### Task 6: 마무리 게이트 + 문서

- [ ] **Step 1:** `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build` 모두 클린.
- [ ] **Step 2:** AGENTS.md 아키텍처 맵에 한 줄 — Job state 항목에 `jobDirSize`(종료 잡 캐시)·bulk-delete·notify 언급.
- [ ] **Step 3:** 커밋 — `docs: 운영 편의 기능 반영`
