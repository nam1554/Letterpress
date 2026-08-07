import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-hosting-check-"));
  process.env.MHM_DATA_DIR = dir;
  // hosting POST가 템플릿을 설정에 저장한다 — 사용자의 settings.json 격리.
  process.env.MHM_SETTINGS_FILE = path.join(dir, "settings.json");
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  delete process.env.MHM_SETTINGS_FILE;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { NextRequest } from "next/server";
import { GET } from "./route";
import { POST as hostingRoute } from "../route";
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

  it("checks what the hosting POST actually wrote — 생산자·소비자 계약", async () => {
    // manifest를 손으로 쓰지 않는다: POST가 만든 매핑 그대로 검사가 돌아야,
    // manifest 형태가 바뀌었을 때 테스트가 함께 깨진다.
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    await mkdir(outputDir(job.id), { recursive: true });
    await writeFile(
      path.join(outputDir(job.id), "edm_figma.html"),
      '<img src="images/logo.png" alt="">',
    );
    const posted = await hostingRoute(
      new NextRequest("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({
          template: "https://cdn.example.com/iiif/3/{folder}__{file}/full/max/0/default.{ext}",
          folder: "contract",
        }),
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(posted.status).toBe(200);

    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    const body = await (await call(job.id)).json();
    expect(body.live).toBe(1);
    expect(body.checks[0]).toMatchObject({
      file: "logo.png",
      uploadKey: "contract__logo.png",
      state: "live",
    });
    await deleteJob(job.id);
  });

  it("names the legacy-hosted trap instead of suggesting a fresh 교체본", async () => {
    // 매핑 기록 이전 버전의 hosted/ — "먼저 생성하세요"라고만 하면 오늘 날짜
    // 폴더로 재생성해 멀쩡한 캠페인 교체본을 덮어쓰게 유도한다.
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const hosted = path.join(outputDir(job.id), "hosted");
    await mkdir(hosted, { recursive: true });
    await writeFile(path.join(hosted, "edm_figma.html"), "<html></html>");

    const res = await call(job.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("이전 버전");
    await deleteJob(job.id);
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
