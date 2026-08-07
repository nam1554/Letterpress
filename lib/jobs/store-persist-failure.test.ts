import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// persist(job.json 원자적 쓰기)의 실패 경로 — 디스크 가득 참·권한 오류를
// writeFile 주입으로 재현한다. appendFileSync(node:fs)는 건드리지 않으므로
// "job.json 쓰기만 실패하는" 부분 장애를 그대로 흉내 낸다.
const disk = vi.hoisted(() => ({ failWrites: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile: typeof real.writeFile = async (...args) => {
    if (disk.failWrites) {
      // ENOSPC는 파일을 부분적으로 만든 뒤 실패할 수 있다 — 그 잔재까지 재현.
      await real.writeFile(...args);
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    }
    return real.writeFile(...args);
  };
  return { ...real, writeFile };
});

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-persist-fail-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  disk.failWrites = false;
});

import { createJob, deleteJob, getJob, listJobs, readEvents, updateJob } from "./store";

describe("persist failure", () => {
  it("keeps a readable job visible when reconcile cannot persist", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(job.id, { status: "running", createdAt: Date.now() - 60_000 });

    // 디스크 쓰기가 안 되는 동안에도 job.json은 읽힌다 — 잡이 null(없음)로
    // 사라지면 홈 목록과 상세 화면에서 실행 기록이 통째로 증발한다.
    disk.failWrites = true;
    const seen = await getJob(job.id);
    expect(seen).not.toBeNull();
    expect(seen?.status).toBe("failed");
    expect((await listJobs()).some((j) => j.id === job.id)).toBe(true);

    // persist가 안 된 동안 5초 폴링이 반복 reconcile해도 에러 이벤트가 쌓이면
    // 안 된다 (기록은 persist 성공 시에만 한 번).
    await getJob(job.id);
    await getJob(job.id);
    expect((await readEvents(job.id)).filter((e) => e.type === "error").length).toBe(0);

    // 디스크가 복구되면 다음 읽기가 persist를 재시도해 판정이 파일에 남는다.
    disk.failWrites = false;
    expect((await getJob(job.id))?.status).toBe("failed");
    const raw = JSON.parse(await readFile(path.join(dir, job.id, "job.json"), "utf8"));
    expect(raw.status).toBe("failed");
    expect((await readEvents(job.id)).filter((e) => e.type === "error").length).toBe(1);
    await deleteJob(job.id);
  });

  it("cleans up the partially written tmp file when the write fails", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");

    disk.failWrites = true;
    await expect(updateJob(job.id, { summary: "wont stick" })).rejects.toThrow(/ENOSPC/);
    disk.failWrites = false;

    // 부분 기록된 tmp가 남으면 잡 디렉터리에 실패마다 하나씩 쌓인다.
    const leftovers = (await readdir(path.join(dir, job.id))).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    // 원본 job.json은 원자성 덕에 그대로다.
    const raw = JSON.parse(await readFile(path.join(dir, job.id, "job.json"), "utf8"));
    expect(raw.summary).toBeUndefined();
    await deleteJob(job.id);
  });
});
