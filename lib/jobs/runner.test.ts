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
import { createJob, getJob, listArtifacts, type Job } from "./store";

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
    startJob(job);
    const done = await waitTerminal(job.id);

    expect(done.status).toBe("succeeded");
    expect(done.verify?.result).toBe("PASS");
    const rels = (await listArtifacts(job.id)).map((a) => a.rel);
    expect(rels).toContain("edm_figma.html");
    expect(rels).toContain("edm_responsive.html");
  }, 20_000);
});
