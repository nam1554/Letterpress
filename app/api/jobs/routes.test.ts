import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { GET as listJobsRoute, POST as createJobRoute } from "./route";
import { DELETE as deleteJobRoute, GET as getJobRoute } from "./[id]/route";
import { POST as cancelRoute } from "./[id]/cancel/route";
import { POST as resumeRoute } from "./[id]/resume/route";
import { POST as editRoute } from "./[id]/edit/route";
import { POST as hostingRoute } from "./[id]/hosting/route";
import { GET as checkRoute } from "./[id]/check/route";
import { GET as downloadRoute } from "./[id]/download/route";
import { GET as previewRoute } from "./[id]/preview/[...path]/route";
import { GET as verifyRoute } from "./[id]/verify/[name]/route";
import { PUT as artifactRoute } from "./[id]/artifact/route";
import { liveControllers } from "@/lib/jobs/live";
import { createEditJob, createJob, getJob, outputDir, updateJob, workDir } from "@/lib/jobs/store";
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

describe("GET /api/jobs", () => {
  it("includes per-job diskBytes", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await writeFile(path.join(workDir(job.id), "blob.bin"), Buffer.alloc(2048));
    const body = await (await listJobsRoute()).json();
    const row = body.jobs.find((j: { id: string }) => j.id === job.id);
    expect(row.diskBytes).toBeGreaterThanOrEqual(2048);
  });
});

describe("POST /api/jobs/bulk-delete", () => {
  it("rejects an empty or malformed body", async () => {
    const { POST: bulk } = await import("./bulk-delete/route");
    expect((await bulk(post({ ids: [] }))).status).toBe(400);
    expect((await bulk(post({}))).status).toBe(400);
  });

  it("deletes deletable jobs, reports missing and running ones individually", async () => {
    const { POST: bulk } = await import("./bulk-delete/route");
    const done = await createJob(FIGMA_URL, "mock");
    await updateJob(done.id, { status: "failed" });
    const running = await createJob(FIGMA_URL, "mock");
    liveControllers.set(running.id, new AbortController());

    const res = await bulk(post({ ids: [done.id, "00000000", running.id] }));
    const { results } = await res.json();
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false]);
    expect(existsSync(workDir(done.id))).toBe(false);
    expect(existsSync(workDir(running.id))).toBe(true); // 실행 중 잡은 보존

    liveControllers.clear();
    await bulk(post({ ids: [running.id] })); // 정리
  });
});

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
    const before = (await (await listJobsRoute()).json()).jobs.length;
    const res = await createJobRoute(post({ figmaUrl: FIGMA_URL, provider: "mock" }));
    expect(res.status).toBe(429);
    // 한도 판정이 startJob으로 옮겨졌으므로 잡이 먼저 만들어졌다 폐기된다 —
    // 유령 queued가 목록에 남으면 안 된다.
    expect((await (await listJobsRoute()).json()).jobs.length).toBe(before);
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

describe("PUT /api/jobs/:id/artifact", () => {
  const put = (body: unknown) =>
    new NextRequest("http://localhost/api", { method: "PUT", body: JSON.stringify(body) });
  const ORIGINAL = "<html><body>원본</body></html>";

  async function succeededJobWithHtml() {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "succeeded" });
    await writeFile(path.join(outputDir(job.id), "edm_figma.html"), ORIGINAL);
    return job;
  }

  it("경로 탈출·비HTML·하위 경로를 거부한다", async () => {
    const job = await succeededJobWithHtml();
    for (const file of ["../job.json", "images/logo.png", "hosted/edm_figma.html", "note.txt", "a\\b.html"]) {
      const res = await artifactRoute(put({ file, html: "<html></html>" }), ctx(job.id));
      expect(res.status, file).toBe(400);
    }
  });

  it("실행 중인 잡은 409", async () => {
    const job = await createJob(FIGMA_URL, "mock"); // queued 상태 유지
    const res = await artifactRoute(put({ file: "edm_figma.html", html: "<html></html>" }), ctx(job.id));
    expect(res.status).toBe(409);
  });

  it("없는 산출물은 404", async () => {
    const job = await succeededJobWithHtml();
    const res = await artifactRoute(put({ file: "missing.html", html: "<html></html>" }), ctx(job.id));
    expect(res.status).toBe(404);
  });

  it("저장은 덮어쓰고, 백업은 첫 저장에만 만들고, manualEdits를 기록한다", async () => {
    const job = await succeededJobWithHtml();
    const backup = path.join(workDir(job.id), "edit-backup", "edm_figma.html");

    const res1 = await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v2</body></html>" }), ctx(job.id));
    expect(res1.status).toBe(200);
    expect(await readFile(path.join(outputDir(job.id), "edm_figma.html"), "utf8")).toContain("v2");
    expect(await readFile(backup, "utf8")).toBe(ORIGINAL);
    expect((await getJob(job.id))?.manualEdits?.["edm_figma.html"]).toBeTypeOf("number");

    // 두 번째 저장 — 백업은 여전히 최초 원본
    await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v3</body></html>" }), ctx(job.id));
    expect(await readFile(backup, "utf8")).toBe(ORIGINAL);
  });

  it("restore는 원본을 되돌리고 manualEdits 엔트리를 지운다", async () => {
    const job = await succeededJobWithHtml();
    await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>수정</body></html>" }), ctx(job.id));

    const res = await artifactRoute(put({ file: "edm_figma.html", restore: true }), ctx(job.id));
    expect(res.status).toBe(200);
    expect(await readFile(path.join(outputDir(job.id), "edm_figma.html"), "utf8")).toBe(ORIGINAL);
    expect((await getJob(job.id))?.manualEdits?.["edm_figma.html"]).toBeUndefined();
  });

  it("백업이 없는 파일의 restore는 404", async () => {
    const job = await succeededJobWithHtml();
    const res = await artifactRoute(put({ file: "edm_figma.html", restore: true }), ctx(job.id));
    expect(res.status).toBe(404);
  });

  it("동시 저장이 서로의 manualEdits 엔트리를 지우지 않는다", async () => {
    const job = await succeededJobWithHtml();
    await writeFile(path.join(outputDir(job.id), "edm_responsive.html"), ORIGINAL);

    // 두 탭에서 파일 하나씩 동시에 저장 — 진입 시점 잡 스냅샷으로 manualEdits를
    // 계산하면 나중 요청이 앞 요청의 엔트리를 덮어, 수정 표시와 복원 버튼이
    // 조용히 사라진다.
    const [a, b] = await Promise.all([
      artifactRoute(put({ file: "edm_figma.html", html: "<html><body>a</body></html>" }), ctx(job.id)),
      artifactRoute(put({ file: "edm_responsive.html", html: "<html><body>b</body></html>" }), ctx(job.id)),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const edits = (await getJob(job.id))?.manualEdits ?? {};
    expect(Object.keys(edits).sort()).toEqual(["edm_figma.html", "edm_responsive.html"]);
  });

  it("같은 파일의 겹친 저장에서도 백업은 진짜 원본이다", async () => {
    const job = await succeededJobWithHtml();
    const backup = path.join(workDir(job.id), "edit-backup", "edm_figma.html");

    // 저장 더블클릭 — 직렬화가 없으면 existsSync 검사와 copyFile 사이에 다른
    // 저장의 writeFile이 끼어, 수정본이 "원본"으로 백업될 수 있다.
    await Promise.all([
      artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v2</body></html>" }), ctx(job.id)),
      artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v3</body></html>" }), ctx(job.id)),
    ]);
    expect(await readFile(backup, "utf8")).toBe(ORIGINAL);
  });

  it("부분 수정 잡은 원본 잡의 edit-backup을 물려받지 않는다", async () => {
    const job = await succeededJobWithHtml();
    await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>수정</body></html>" }), ctx(job.id));

    // work/ 전체 복사에 백업이 섞이면, 새 잡의 첫 수동 저장이 자기 원본을
    // 백업하지 않고 복원이 원본 잡의 옛 내용으로 이 잡의 산출물을 덮는다.
    const edit = await createEditJob((await getJob(job.id))!, "헤드라인을 바꿔줘");
    expect(existsSync(path.join(workDir(edit.id), "edit-backup"))).toBe(false);
    // 산출물 자체는 그대로 복사되어야 한다.
    expect(existsSync(path.join(outputDir(edit.id), "edm_figma.html"))).toBe(true);
  });
});
