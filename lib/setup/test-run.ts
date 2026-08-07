import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hmrGlobal } from "../hmr-global";
import { getProvider } from "../providers/registry";

// ---------------------------------------------------------------------------
// 연동 테스트 — 실제 CLI를 초소형 프롬프트로 스폰해 왕복을 확인한다.
// (10분짜리 실제 변환을 돌리지 않고도 "진짜 동작함"을 확정하는 용도)
// ---------------------------------------------------------------------------

export interface BackendTestResult {
  ok: boolean;
  summary: string;
  ms: number;
}

const TEST_PROMPT =
  'This is a connectivity check. Reply with exactly "READY" and nothing else. Do not use any tools.';

export async function runBackendTest(id: string): Promise<BackendTestResult> {
  // 같은 백엔드의 테스트가 이미 도는 중이면 합류한다 (중복 스폰 방지).
  const tests = hmrGlobal(
    "__mhmSetupTests",
    () => new Map<string, Promise<BackendTestResult>>(),
  );
  const inFlight = tests.get(id);
  if (inFlight) return inFlight;

  const run = (async (): Promise<BackendTestResult> => {
    const provider = getProvider(id); // 알 수 없는 id는 여기서 throw
    const workDir = await mkdtemp(path.join(os.tmpdir(), "mhm-setup-test-"));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    const started = Date.now();
    try {
      const result = await provider.run(
        {
          jobId: "setup-test",
          figmaUrl: "https://www.figma.com/design/x/y",
          workDir,
          promptOverride: TEST_PROMPT,
        },
        () => {},
        ac.signal,
      );
      const timedOut = ac.signal.aborted;
      return {
        ok: result.ok && !timedOut,
        summary: timedOut ? "2분 안에 응답이 없어 중단했습니다." : result.summary.slice(0, 500),
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      void rm(workDir, { recursive: true, force: true });
    }
  })();
  tests.set(id, run);
  try {
    return await run;
  } finally {
    tests.delete(id);
  }
}
