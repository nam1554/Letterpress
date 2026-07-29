import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsonlCli } from "./jsonl-cli";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mhm-jsonl-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** node -e 로 돌릴 소형 CLI 스텁. */
function run(script: string, signal = new AbortController().signal) {
  const json: unknown[] = [];
  const text: string[] = [];
  return {
    json,
    text,
    result: runJsonlCli({
      bin: process.execPath,
      args: ["-e", script],
      cwd: dir,
      env: process.env,
      signal,
      onJson: (o) => void json.push(o),
      onText: (t) => void text.push(t),
    }),
  };
}

describe("runJsonlCli", () => {
  it("streams JSON lines in order and routes non-JSON to onText", async () => {
    const r = run(
      `process.stdout.write('{"a":1}\\n');
       process.stdout.write('not json\\n');
       process.stdout.write('{"a":2}\\n');`,
    );
    const result = await r.result;
    expect(result.kind).toBe("closed");
    expect(result.code).toBe(0);
    expect(r.json).toEqual([{ a: 1 }, { a: 2 }]);
    expect(r.text).toEqual(["not json"]);
  });

  it("delivers a trailing line that has no newline", async () => {
    const r = run(`process.stdout.write('{"last":true}')`);
    await r.result;
    expect(r.json).toEqual([{ last: true }]);
  });

  it("keeps the tail of stderr and the exit code", async () => {
    const r = run(
      `process.stderr.write('x'.repeat(3000) + 'BOOM\\n'); process.exit(3);`,
    );
    const result = await r.result;
    expect(result.kind).toBe("closed");
    expect(result.code).toBe(3);
    expect(result.stderrTail.length).toBeLessThanOrEqual(2000);
    expect(result.stderrTail).toContain("BOOM");
  });

  it("reports a missing binary as a spawn error, not a crash", async () => {
    const result = await runJsonlCli({
      bin: path.join(dir, "no-such-binary"),
      args: [],
      cwd: dir,
      env: process.env,
      signal: new AbortController().signal,
      onJson: () => {},
      onText: () => {},
    });
    expect(result.kind).toBe("spawn-error");
    expect(result.error).toBeInstanceOf(Error);
  });

  it("kills the whole process tree on abort (grandchildren included)", async () => {
    // CLI들은 래퍼가 실제 바이너리를 다시 spawn한다 — 직계 자식만 죽이면
    // 손자가 고아로 남아 토큰을 계속 소모한다.
    const marker = path.join(dir, "grandchild.txt");
    const grandchild = `setInterval(() => require('fs').writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 50)`;
    const controller = new AbortController();
    const r = run(
      `const { spawn } = require('child_process');
       spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
       process.stdout.write('{"started":true}\\n');
       setInterval(() => {}, 1000);`,
      controller.signal,
    );

    // 손자가 실제로 살아 움직이기 시작할 때까지 기다린다.
    for (let i = 0; i < 60 && !existsSync(marker); i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(existsSync(marker)).toBe(true);

    controller.abort();
    const result = await r.result;
    expect(result.kind).toBe("aborted");

    // 종료 후에는 마커 파일이 더 이상 갱신되지 않아야 한다.
    await new Promise((res) => setTimeout(res, 300));
    const first = await readFile(marker, "utf8");
    await new Promise((res) => setTimeout(res, 300));
    expect(await readFile(marker, "utf8")).toBe(first);
  }, 15_000);
});

describe("신호 종료", () => {
  it("신호로 죽은 실행은 spawn 오류가 아니라 '실행됨'이고, 신호 이름을 남긴다", async () => {
    const controller = new AbortController();
    const r = run(`setInterval(() => {}, 100)`, controller.signal);
    await new Promise((res) => setTimeout(res, 300));
    // 취소가 아니라 외부에서 죽는 상황(OOM 킬러 등)을 흉내낸다.
    process.kill(-0, 0); // no-op: 아래에서 execa가 띄운 자식을 직접 죽인다
    const { execa } = await import("execa");
    await execa("pkill", ["-KILL", "-f", "setInterval\\(\\(\\) => \\{\\}, 100\\)"]).catch(() => {});
    const result = await r.result;
    expect(result.kind).toBe("closed"); // spawn-error가 아니어야 stderr 꼬리가 살아남는다
    expect(result.signal).toBe("SIGKILL");
  }, 15_000);
});
