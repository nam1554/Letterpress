import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-store-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

// Import after env setup happens at call time because dataDir() reads env lazily.
import {
  appendEvent,
  createJob,
  deleteJob,
  getJob,
  invalidateJobSize,
  jobDirSize,
  listJobs,
  readEvents,
  reserveJobId,
  resolveArtifact,
  subscribe,
  updateJob,
  workDir,
} from "./store";
import { liveControllers } from "./live";

describe("job store lifecycle", () => {
  it("creates, updates, lists, and deletes a job", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    expect((await getJob(job.id))?.status).toBe("queued");

    await updateJob(job.id, { status: "succeeded", summary: "done" });
    const listed = await listJobs();
    expect(listed.find((j) => j.id === job.id)?.summary).toBe("done");

    expect(await deleteJob(job.id)).toBe(true);
    expect(await getJob(job.id)).toBeNull();
  });

  it("refuses to delete a job with a live controller", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    liveControllers.set(job.id, new AbortController());
    expect(await deleteJob(job.id)).toBe(false);
    liveControllers.delete(job.id);
    expect(await deleteJob(job.id)).toBe(true);
  });

  it("reconciles a stale running job to failed exactly once", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(job.id, { status: "running" });
    // Backdate past the grace period, then read concurrently.
    await updateJob(job.id, { createdAt: Date.now() - 60_000 });
    const [a, b] = await Promise.all([getJob(job.id), getJob(job.id)]);
    expect([a?.status, b?.status]).toContain("failed");
    expect((await getJob(job.id))?.status).toBe("failed");
    const errorEvents = (await readEvents(job.id)).filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    await deleteJob(job.id);
  });

  it("gives every concurrent reader the reconciled result", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(job.id, { status: "running", createdAt: Date.now() - 60_000 });

    // 진행 중인 reconcile을 만난 읽기가 낡은 "실행 중"을 돌려주면, 그 요청을
    // 띄운 화면은 이미 실패한 잡을 실행 중으로 표시한다.
    const seen = await Promise.all([getJob(job.id), getJob(job.id), getJob(job.id)]);
    expect(seen.map((j) => j?.status)).toEqual(["failed", "failed", "failed"]);
    expect((await readEvents(job.id)).filter((e) => e.type === "error").length).toBe(1);
    await deleteJob(job.id);
  });

  it("never hands out a job id whose directory already exists", async () => {
    const taken = await createJob("https://www.figma.com/design/abc/", "mock");
    // 충돌하면 createJob이 기존 잡 위에 그대로 덮어써 데이터가 사라진다.
    const queue = [taken.id, taken.id, "cafebabe"];
    expect(reserveJobId(() => queue.shift()!)).toBe("cafebabe");
    await deleteJob(taken.id);
  });

  it("does not reconcile jobs with a live controller", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(job.id, { status: "running", createdAt: Date.now() - 60_000 });
    liveControllers.set(job.id, new AbortController());
    expect((await getJob(job.id))?.status).toBe("running");
    liveControllers.delete(job.id);
    await deleteJob(job.id);
  });

  it("assigns monotonically increasing seq to events", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "a" });
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "a" });
    appendEvent(job.id, { ts: Date.now(), type: "status", text: "b" });
    const events = await readEvents(job.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    await deleteJob(job.id);
  });

  it("truncates oversized event text", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "x".repeat(10_000) });
    const [event] = await readEvents(job.id);
    expect(event.text.length).toBeLessThan(4100);
    expect(event.text.endsWith("(truncated)")).toBe(true);
    await deleteJob(job.id);
  });

  it("skips a corrupt event line instead of discarding the whole log", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "first" });
    // 프로세스가 append 도중 죽으면 마지막 줄이 잘린 채 남는다.
    appendFileSync(path.join(dir, job.id, "events.ndjson"), '{"ts":1,"type":"log"\n');
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "second" });

    const events = await readEvents(job.id);
    expect(events.map((e) => e.text)).toEqual(["first", "second"]);
    await deleteJob(job.id);
  });

  it("survives a listener that throws, and still notifies the others", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const seen: string[] = [];
    const unsubBad = subscribe(job.id, () => {
      throw new Error("listener boom");
    });
    const unsubGood = subscribe(job.id, (e) => void seen.push(e.text));

    expect(() =>
      appendEvent(job.id, { ts: Date.now(), type: "log", text: "hello" }),
    ).not.toThrow();
    expect(seen).toEqual(["hello"]);

    unsubBad();
    unsubGood();
    await deleteJob(job.id);
  });

  it("does not throw when the job directory is gone", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await deleteJob(job.id);
    // 로깅 실패가 실행 중인 잡을 죽이면 안 된다.
    expect(() => appendEvent(job.id, { ts: Date.now(), type: "log", text: "x" })).not.toThrow();
  });

  it("keeps job.json parseable via atomic writes", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => updateJob(job.id, { summary: `s${i}` })),
    );
    const raw = await readFile(path.join(dir, job.id, "job.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    await deleteJob(job.id);
  });
});

describe("resolveArtifact", () => {
  it("rejects traversal and the output dir itself", () => {
    expect(resolveArtifact("deadbeef", "../../../etc/passwd")).toBeNull();
    expect(resolveArtifact("deadbeef", "..")).toBeNull();
    expect(resolveArtifact("deadbeef", ".")).toBeNull();
    expect(resolveArtifact("deadbeef", "")).toBeNull();
    expect(resolveArtifact("deadbeef", "a/../../x")).toBeNull();
  });

  it("rejects malformed job ids before any fs path is built", async () => {
    expect(resolveArtifact("../escape", "x.html")).toBeNull();
    expect(resolveArtifact("..", "x.html")).toBeNull();
    expect(await getJob("../escape")).toBeNull();
    expect(await getJob("DEADBEEF!")).toBeNull();
  });

  it("accepts nested paths inside output", () => {
    expect(resolveArtifact("deadbeef", "images/logo.png")).toContain(
      path.join("deadbeef", "work", "output", "images", "logo.png"),
    );
  });
});

describe("jobDirSize", () => {
  it("sums the job directory and caches per status", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await writeFile(path.join(workDir(job.id), "a.bin"), Buffer.alloc(1000));
    // 실행 중 잡도 짧은 TTL로 캐시한다 — 홈이 5초마다 폴링하는데 매번 work/
    // 트리를 재귀 탐색하면 SSE 로그·다운로드와 이벤트 루프를 다툰다.
    const running = await jobDirSize(job);
    await writeFile(path.join(workDir(job.id), "b.bin"), Buffer.alloc(500));
    expect(await jobDirSize(job)).toBe(running);

    const done = { ...job, status: "succeeded" as const };
    const cached = await jobDirSize(done); // 상태가 바뀌었으니 다시 잰다
    expect(cached).toBe(running + 500);
    await writeFile(path.join(workDir(job.id), "c.bin"), Buffer.alloc(9999));
    expect(await jobDirSize(done)).toBe(cached); // 종료 잡은 계속 캐시 적중
    await deleteJob(job.id);
  });

  it("re-measures after a resume puts a finished job back to work", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const done = { ...job, status: "succeeded" as const };
    const first = await jobDirSize(done);
    // 이어서 실행·부분 수정은 같은/복사된 workDir에서 파일을 더 만든다. 상태를
    // 캐시 키에 포함하지 않으면 종료 잡의 옛 수치가 영원히 남는다.
    await writeFile(path.join(workDir(job.id), "resumed.bin"), Buffer.alloc(2048));
    await jobDirSize({ ...job, status: "running" as const });
    expect(await jobDirSize(done)).toBe(first + 2048);
    await deleteJob(job.id);
  });

  it("invalidates the cache when the job dir is written from outside", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const done = { ...job, status: "succeeded" as const };
    const first = await jobDirSize(done);
    await writeFile(path.join(workDir(job.id), "hosted.html"), Buffer.alloc(4096));
    expect(await jobDirSize(done)).toBe(first); // 캐시 적중 (아직 무효화 전)
    invalidateJobSize(job.id);
    expect(await jobDirSize(done)).toBe(first + 4096);
    await deleteJob(job.id);
  });

  it("invalidates the cache on deleteJob", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const done = { ...job, status: "failed" as const };
    expect(await jobDirSize(done)).toBeGreaterThan(0); // job.json 존재 → 캐시됨
    await deleteJob(job.id);
    // 캐시가 남았다면 이전 값이 돌아온다 — 무효화됐으면 디렉터리 부재로 0
    expect(await jobDirSize(done)).toBe(0);
  });
});
