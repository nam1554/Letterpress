import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-hosting-check-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { GET } from "./route";
import { createJob, deleteJob, outputDir } from "@/lib/jobs/store";

const call = (id: string) =>
  GET(new Request(`http://x/api/jobs/${id}/hosting/check`), {
    params: Promise.resolve({ id }),
  });

async function jobWithManifest(files: string[]): Promise<string> {
  const job = await createJob("https://www.figma.com/design/abc/", "mock");
  const hosted = path.join(outputDir(job.id), "hosted");
  await mkdir(hosted, { recursive: true });
  await writeFile(
    path.join(hosted, "manifest.json"),
    JSON.stringify({
      template: "https://cdn.example.com/iiif/3/{folder}__{file}/full/max/0/default.{ext}",
      folder: "camp",
      files,
      createdAt: 1,
    }),
  );
  return job.id;
}

describe("GET /api/jobs/:id/hosting/check", () => {
  it("404s for a missing job and 400s before any 교체본 exists", async () => {
    expect((await call("00000000")).status).toBe(404);

    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const res = await call(job.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("교체본");
    await deleteJob(job.id);
  });

  it("checks the manifest's URLs and classifies them", async () => {
    const id = await jobWithManifest(["hero.jpg", "logo.png"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("hero") ? { status: 200 } : { status: 404 },
      ),
    );

    const res = await call(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live).toBe(1);
    expect(body.missing).toBe(1);
    expect(body.allUnreachable).toBe(false);
    // 수동 업로드용 오브젝트 키가 함께 온다 (IIIF `{folder}__{file}` 규칙).
    expect(body.checks.find((c: { file: string }) => c.file === "logo.png").uploadKey).toBe(
      "camp__logo.png",
    );
    await deleteJob(id);
  });

  it("reports 전부-연결-불가 so the UI can point at the network, not uploads", async () => {
    const id = await jobWithManifest(["hero.jpg"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const body = await (await call(id)).json();
    expect(body.allUnreachable).toBe(true);
    await deleteJob(id);
  });
});
