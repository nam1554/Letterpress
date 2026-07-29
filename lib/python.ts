import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 파이썬 실행 방법 찾기 — 픽셀 검증 스크립트(compare.py)를 돌리는 인터프리터.
 *
 * 명령 이름이 플랫폼마다 다르다: macOS·리눅스는 `python3`, 윈도우는 보통
 * 런처(`py -3`)이고 `python3`는 아예 없거나 Microsoft Store 설치 안내창만
 * 띄우는 스텁이다. 한 이름으로 박아두면 그 플랫폼 밖에서 환경 점검이 항상
 * 빨간불이 된다.
 */
export interface PythonCommand {
  bin: string;
  args: string[];
}

/** 시도할 후보들 (앞이 우선). */
export function pythonCandidates(platform: NodeJS.Platform = process.platform): PythonCommand[] {
  const override = process.env.PYTHON_BIN?.trim();
  if (override) return [{ bin: override, args: [] }];
  if (platform === "win32") {
    return [
      { bin: "py", args: ["-3"] },
      { bin: "python", args: [] },
      { bin: "python3", args: [] },
    ];
  }
  return [
    { bin: "python3", args: [] },
    { bin: "python", args: [] },
  ];
}

/** 실제로 실행되는 첫 번째 파이썬. 없으면 null. */
export async function findPython(): Promise<PythonCommand | null> {
  for (const candidate of pythonCandidates()) {
    try {
      const { stdout } = await execFileAsync(
        candidate.bin,
        [...candidate.args, "-c", "import sys; print(sys.version_info[0])"],
        { timeout: 10_000 },
      );
      // 윈도우의 Microsoft Store 스텁은 성공한 척하며 아무것도 출력하지 않는다.
      if (stdout.trim() === "3") return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}
