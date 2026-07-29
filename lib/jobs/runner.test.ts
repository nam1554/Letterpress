import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-runner-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { startJob } from "./runner";
import { createEditJob, createJob, getJob, listArtifacts, updateJob, type Job } from "./store";

async function waitTerminal(id: string, timeoutMs = 15_000): Promise<Job> {
  const start = Date.now();
  for (;;) {
    const job = await getJob(id);
    if (job && (job.status === "succeeded" || job.status === "failed")) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job ${id} did not finish`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("runner + quality gate (mock provider)", () => {
  it("runs a mock job through the acceptance gate to success", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await startJob(job);
    const done = await waitTerminal(job.id);

    expect(done.status).toBe("succeeded");
    expect(done.verify?.result).toBe("PASS");
    const rels = (await listArtifacts(job.id)).map((a) => a.rel);
    expect(rels).toContain("edm_figma.html");
    expect(rels).toContain("edm_responsive.html");
  }, 20_000);

  it("resumes a failed job in the same workDir and clears the failure record", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await updateJob(job.id, {
      status: "failed",
      finishedAt: Date.now(),
      summary: "제한 시간(45분)을 초과해 중단되었습니다.",
    });

    await startJob((await getJob(job.id))!, { resume: true });
    const done = await waitTerminal(job.id);

    expect(done.status).toBe("succeeded");
    expect(done.summary).not.toContain("제한 시간");
    expect(done.verify?.result).toBe("PASS");
  }, 20_000);

  it("runs an edit job on a copied workDir", async () => {
    const source = await createJob("https://www.figma.com/design/abc/", "mock");
    await startJob(source);
    await waitTerminal(source.id);

    const edit = await createEditJob(
      (await getJob(source.id))!,
      "헤드라인을 '오늘 시작하세요'로 변경",
    );
    expect(edit.editOf).toBe(source.id);
    // 복사본에 원본 산출물이 그대로 있어야 에이전트가 이어서 작업할 수 있다.
    expect((await listArtifacts(edit.id)).map((a) => a.rel)).toContain("edm_figma.html");

    await startJob(edit);
    const done = await waitTerminal(edit.id);
    expect(done.status).toBe("succeeded");
  }, 30_000);
});
