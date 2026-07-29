import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-sse-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { GET } from "./route";
import { appendEvent, createJob, subscriberCount, updateJob } from "@/lib/jobs/store";

const FIGMA_URL = "https://www.figma.com/design/abc/";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

const call = (id: string, signal?: AbortSignal) =>
  GET(new Request(`http://localhost/api/jobs/${id}/events`, { signal }), {
    params: Promise.resolve({ id }),
  });

describe("job events SSE route", () => {
  it("replays history and closes once the job is terminal", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "첫 줄" });
    appendEvent(job.id, { ts: Date.now(), type: "done", text: "완료" });
    await updateJob(job.id, { status: "succeeded", finishedAt: Date.now() });

    const res = await call(job.id);
    // 스트림이 스스로 닫히지 않으면 여기서 영원히 멈춘다.
    const body = await new Response(res.body).text();

    expect(count(body, "event: agent")).toBe(2);
    expect(body).toContain("첫 줄");
    expect(body).toContain("event: state");
    expect(subscriberCount(job.id)).toBe(0);
  });

  it("relays a live event exactly once after the replay", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "running" });
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "히스토리" });

    const res = await call(job.id);
    const body = new Response(res.body).text();
    await delay(50);

    appendEvent(job.id, { ts: Date.now(), type: "log", text: "라이브" });
    await updateJob(job.id, { status: "succeeded", finishedAt: Date.now() });
    appendEvent(job.id, { ts: Date.now(), type: "done", text: "완료" });

    const text = await body;
    // 리플레이/라이브 경계에서 어느 쪽도 중복되면 안 된다.
    expect(count(text, "히스토리")).toBe(1);
    expect(count(text, "라이브")).toBe(1);
    expect(subscriberCount(job.id)).toBe(0);
  });

  it("cleans up its subscription when the client leaves during replay", async () => {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "running" });
    appendEvent(job.id, { ts: Date.now(), type: "log", text: "히스토리" });

    const ac = new AbortController();
    const res = call(job.id, ac.signal);
    // 리플레이가 끝나기 전에 브라우저 탭이 닫히는 상황.
    ac.abort();
    await res;
    await delay(50);

    // 남으면 잡이 끝날 때까지(또는 영영) 구독이 정리되지 않는다.
    expect(subscriberCount(job.id)).toBe(0);
  });
});
