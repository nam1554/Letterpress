import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-routes-"));
  process.env.MHM_DATA_DIR = dir;
  // 설정 파일도 격리한다 — 테스트가 사용자의 data/settings.json을 건드리면 안 된다.
  process.env.MHM_SETTINGS_FILE = path.join(dir, "settings.json");
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  delete process.env.MHM_SETTINGS_FILE;
  await rm(dir, { recursive: true, force: true });
});

import { NextRequest } from "next/server";
import { POST as createJobRoute } from "./route";
import { DELETE as deleteJobRoute, GET as getJobRoute } from "./[id]/route";
import { POST as cancelRoute } from "./[id]/cancel/route";
import { POST as resumeRoute } from "./[id]/resume/route";
import { POST as editRoute } from "./[id]/edit/route";
import { POST as hostingRoute } from "./[id]/hosting/route";
import { GET as checkRoute } from "./[id]/check/route";
import { GET as downloadRoute } from "./[id]/download/route";
import { GET as previewRoute } from "./[id]/preview/[...path]/route";
import { GET as verifyRoute } from "./[id]/verify/[name]/route";
import { liveControllers } from "@/lib/jobs/live";
import { createJob, outputDir, updateJob } from "@/lib/jobs/store";
import { getSettings } from "@/lib/settings";

const FIGMA_URL = "https://www.figma.com/design/abc123/My-Campaign";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest("http://localhost/api", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (url: string) => new NextRequest(url);

afterEach(() => liveControllers.clear());

describe("POST /api/jobs", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await createJobRoute(post("not json at all"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("JSON");
  });

  it("rejects a missing or non-Figma URL", async () => {
    expect((await createJobRoute(post({}))).status).toBe(400);
    const res = await createJobRoute(post({ figmaUrl: "https://example.com/nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Figma");
  });

  it("rejects an unknown provider", async () => {
    const res = await createJobRoute(post({ figmaUrl: FIGMA_URL, provider: "gpt-9" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("gpt-9");
  });

  it("refuses to exceed the concurrency cap", async () => {
    for (let i = 0; i < getSettings().maxConcurrentJobs; i++) {
      liveControllers.set(`busy${i}`, new AbortController());
    }
    const res = await createJobRoute(post({ figmaUrl: FIGMA_URL, provider: "mock" }));
    expect(res.status).toBe(429);
  });
});

describe("job id handling", () => {
  it("answers 404 for unknown and malformed ids without touching the filesystem", async () => {
    for (const id of ["00000000", "../escape", "DEADBEEF!", ".."]) {
      expect((await getJobRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
      expect((await cancelRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
      expect((await resumeRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
      expect((await deleteJobRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
    }
  });

  it("refuses to delete a job that is still executing", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    liveControllers.set(job.id, new AbortController());
    const res = await deleteJobRoute(new Request("http://localhost"), ctx(job.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("취소");
  });
});

describe("state conflicts", () => {
  it("cancels only a job that is actually running", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "succeeded", finishedAt: Date.now() });
    const res = await cancelRoute(new Request("http://localhost"), ctx(job.id));
    expect(res.status).toBe(409);
  });

  it("resumes only a failed job", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "succeeded", finishedAt: Date.now() });
    const res = await resumeRoute(new Request("http://localhost"), ctx(job.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("실패한 작업");
  });

  it("rejects an edit with no instruction, and one with no artifacts to edit", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "succeeded", finishedAt: Date.now() });

    expect((await editRoute(post({ instruction: "짧음" }), ctx(job.id))).status).toBe(400);

    const res = await editRoute(post({ instruction: "헤드라인을 바꿔줘" }), ctx(job.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("HTML 산출물이 없는");
  });
});

describe("artifact path safety", () => {
  it("refuses traversal in the download file parameter", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    const res = await downloadRoute(
      get(`http://localhost/api?file=${encodeURIComponent("../../../../etc/passwd")}`),
      ctx(job.id),
    );
    expect(res.status).toBe(400);
  });

  it("refuses traversal in the preview path segments", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    const res = await previewRoute(new Request("http://localhost"), {
      params: Promise.resolve({ id: job.id, path: ["..", "..", "..", "etc", "passwd"] }),
    });
    expect(res.status).toBe(400);
  });

  // Next는 라우트 params를 이미 퍼센트 디코딩해 넘긴다 (실제 서버로 확인).
  // 라우트가 한 번 더 디코딩하면 '100%.png'는 URIError로 500이 되고,
  // 이름에 '%'가 든 파일은 어떤 URL로도 도달할 수 없게 된다.
  it("serves a file whose name contains a percent sign", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await writeFile(path.join(outputDir(job.id), "100%.png"), "png");
    const res = await previewRoute(new Request("http://localhost"), {
      params: Promise.resolve({ id: job.id, path: ["100%.png"] }),
    });
    expect(res.status).toBe(200);
  });

  it("serves only allowlisted verification images", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    for (const name of ["evil.png", "../job.json", "verify.json"]) {
      const res = await verifyRoute(new Request("http://localhost"), {
        params: Promise.resolve({ id: job.id, name }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("checks only HTML artifacts inside the job output", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await writeFile(path.join(outputDir(job.id), "edm.html"), "<html></html>");

    expect((await checkRoute(get("http://localhost/api"), ctx(job.id))).status).toBe(400);
    expect(
      (await checkRoute(get("http://localhost/api?file=notes.txt"), ctx(job.id))).status,
    ).toBe(400);
    expect(
      (
        await checkRoute(
          get(`http://localhost/api?file=${encodeURIComponent("../../../x.html")}`),
          ctx(job.id),
        )
      ).status,
    ).toBe(400);
    expect((await checkRoute(get("http://localhost/api?file=edm.html"), ctx(job.id))).status).toBe(
      200,
    );
  });
});

describe("POST /api/jobs/:id/hosting", () => {
  it("rejects a template that is not an https URL", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    const res = await hostingRoute(post({ template: "cdn.example.com/{file}" }), ctx(job.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("https://");
  });

  it("requires a folder when the template has {folder}, and validates it", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    const tpl = "https://cdn.example.com/{folder}/{file}";

    const missing = await hostingRoute(post({ template: tpl }), ctx(job.id));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("{folder}");

    const bad = await hostingRoute(post({ template: tpl, folder: "폴더 이름/" }), ctx(job.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("폴더명");
  });
});
