import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// 알림은 잡 상태와 무관한 부가 기능이라 목으로 관찰만 한다.
const notifyMock = vi.fn();
vi.mock("./notify", () => ({ notifyJobFinished: (job: unknown) => notifyMock(job) }));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-runner-"));
  process.env.MHM_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MHM_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

import { cancelJob, startJob } from "./runner";
import { mockProvider } from "../providers/mock";
import { abortAllForShutdown, liveControllers } from "./live";
import type { AgentEvent } from "../providers/types";
import {
  createEditJob,
  createJob,
  getJob,
  listArtifacts,
  subscribe,
  updateJob,
  type Job,
} from "./store";

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

  // root는 퍼미션을 무시하므로 쓰기 실패를 만들 수 없다.
  const asRoot = process.getuid?.() === 0;
  it.skipIf(asRoot)("does not leak the live controller when start-up fails", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    // 디스크 가득참·권한 오류로 job.json 쓰기가 실패하는 상황.
    await chmod(path.join(dir, job.id), 0o500);

    await expect(startJob(job)).rejects.toThrow();
    // 누수되면 runningJobCount()가 영구히 부풀어 동시 실행 한도가 모든 신규
    // 작업을 막고, deleteJob도 계속 거부된다.
    expect(liveControllers.has(job.id)).toBe(false);

    await chmod(path.join(dir, job.id), 0o700);
  });

  it.skipIf(asRoot)("emits a terminal event even when the final persist fails", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const realRun = mockProvider.run;
    // 실행 도중 디스크가 나빠져(가득 참·권한) 종료 기록 쓰기가 실패하는 상황.
    mockProvider.run = async () => {
      await chmod(path.join(dir, job.id), 0o500);
      return { ok: false, summary: "CLI가 죽었습니다." };
    };
    const events: AgentEvent[] = [];
    const unsub = subscribe(job.id, (e) => void events.push(e));
    try {
      // promptOverride: 게이트(브라우저 측정)를 건너뛴다 — 여기서 재는 것은
      // 종료 기록 경로뿐이다.
      await startJob(job, { promptOverride: "smoke" });
      // 종료 이벤트가 구독자(SSE)에게 나가지 않으면 열려 있던 잡 화면은
      // "실행 중"에 영영 멈추고, 러너의 비동기 블록은 rejection으로 끝난다.
      await vi.waitFor(
        () => {
          expect(events.some((e) => e.type === "error" && e.text.startsWith("실패"))).toBe(true);
        },
        { timeout: 10_000 },
      );
      expect(liveControllers.has(job.id)).toBe(false);
    } finally {
      unsub();
      mockProvider.run = realRun;
      await chmod(path.join(dir, job.id), 0o700);
    }
  }, 20_000);

  it("fails an edit job that reuses the source's verification instead of re-running it", async () => {
    const source = await createJob("https://www.figma.com/design/abc/", "mock");
    await startJob(source);
    await waitTerminal(source.id);

    const edit = await createEditJob((await getJob(source.id))!, "헤드라인 변경");
    // 산출물도 verify.json도 원본에서 복사돼 이미 자리에 있다. 에이전트가
    // 아무것도 하지 않아도 성공으로 보이면 게이트가 무의미해진다.
    const realRun = mockProvider.run;
    mockProvider.run = async () => ({ ok: true, summary: "아무것도 생성하지 않음" });
    try {
      await startJob(edit);
      const done = await waitTerminal(edit.id);
      expect(done.status).toBe("failed");
      expect(done.summary).toContain("품질 게이트");
    } finally {
      mockProvider.run = realRun;
    }
  }, 30_000);

  it("does not send a failure notification when the user cancels", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const realRun = mockProvider.run;
    // 실제 백엔드(claude-code·codex)는 중단 시 예외를 던지지 않고
    // {ok:false}로 끝난다 — 취소 판정을 catch에만 두면 여기서 알림이 나간다.
    mockProvider.run = async () => {
      cancelJob(job.id);
      return { ok: false, summary: "사용자가 취소했습니다." };
    };
    notifyMock.mockClear();
    try {
      await startJob(job);
      const done = await waitTerminal(job.id);
      expect(done.status).toBe("failed");
      expect(notifyMock).not.toHaveBeenCalled();
    } finally {
      mockProvider.run = realRun;
    }
  }, 20_000);

  it("still notifies on a real failure", async () => {
    const job = await createJob("https://www.figma.com/design/abc/", "mock");
    const realRun = mockProvider.run;
    mockProvider.run = async () => ({ ok: false, summary: "CLI가 죽었습니다." });
    notifyMock.mockClear();
    try {
      await startJob(job);
      await waitTerminal(job.id);
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    } finally {
      mockProvider.run = realRun;
    }
  }, 20_000);

  it("aborts every live job on shutdown", () => {
    const controller = new AbortController();
    liveControllers.set("deadbeef", controller);
    abortAllForShutdown();
    expect(controller.signal.aborted).toBe(true);
    expect(liveControllers.size).toBe(0);
  });

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
