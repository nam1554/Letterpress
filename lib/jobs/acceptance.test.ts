import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-acceptance-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { checkAcceptance, readVerifySummary } from "./acceptance";
import { createJob, outputDir, workDir } from "./store";

const PASS_JSON = JSON.stringify({
  result: "PASS",
  overall: 97.3,
  height_delta: 2,
  bands: [{ name: "header", sim: 99.1, shift: 0, ok: true }],
});

/** 완전한 산출물 세트를 가진 잡을 만든다. */
async function fullJob(verifyJson: string | null = PASS_JSON) {
  const job = await createJob("https://www.figma.com/design/abc/", "mock");
  const base = workDir(job.id);
  const out = outputDir(job.id);
  await mkdir(path.join(out, "images"), { recursive: true });
  await writeFile(path.join(out, "edm_figma.html"), "<html/>");
  await writeFile(path.join(out, "edm_responsive.html"), "<html/>");
  await writeFile(path.join(out, "images", "logo.png"), "png");
  for (const f of ["figma_full.png", "my_full.png", "side_by_side.png", "diff_heat.png"]) {
    await writeFile(path.join(base, f), "png");
  }
  if (verifyJson !== null) await writeFile(path.join(base, "verify.json"), verifyJson);
  return job;
}

describe("checkAcceptance", () => {
  it("passes a complete deliverable set", async () => {
    const job = await fullJob();
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(true);
    expect(a.failures).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(a.verify).toEqual({ result: "PASS", overall: 97.3, heightDelta: 2 });
  });

  it("fails when final HTML files are missing", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("_figma.html");
    expect(a.failures.join(" ")).toContain("_responsive.html");
  });

  it("finds HTML deliverables in nested output folders", async () => {
    const job = await fullJob();
    const nested = path.join(outputDir(job.id), "hosted");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "edm_hosted.html"), "<html/>");
    expect((await checkAcceptance(job.id)).ok).toBe(true);
  });

  it("fails when verify evidence images are missing", async () => {
    const job = await fullJob();
    await rm(path.join(workDir(job.id), "my_full.png"));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("my_full.png");
  });

  it("fails when verify.json is absent or malformed", async () => {
    const missing = await fullJob(null);
    expect((await checkAcceptance(missing.id)).failures.join(" ")).toContain("verify.json");

    const malformed = await fullJob("{not json");
    const a = await checkAcceptance(malformed.id);
    expect(a.ok).toBe(false);
    expect(a.verify).toBeNull();
  });

  it("fails when the verify result is FAIL", async () => {
    const job = await fullJob(JSON.stringify({ result: "FAIL", overall: 88.2, height_delta: 40 }));
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(false);
    expect(a.failures.join(" ")).toContain("FAIL");
    expect(a.verify).toEqual({ result: "FAIL", overall: 88.2, heightDelta: 40 });
  });

  it("only warns when images/ is empty", async () => {
    const job = await fullJob();
    await rm(path.join(outputDir(job.id), "images"), { recursive: true });
    const a = await checkAcceptance(job.id);
    expect(a.ok).toBe(true);
    expect(a.warnings.join(" ")).toContain("images");
  });
});

describe("readVerifySummary", () => {
  it("returns null for unknown result values", async () => {
    const job = await fullJob(JSON.stringify({ result: "MAYBE" }));
    expect(await readVerifySummary(job.id)).toBeNull();
  });
});
