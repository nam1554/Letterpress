import { existsSync } from "node:fs";
import path from "node:path";
import { workDir } from "./jobs/store";

// 파이프라인(figma-edm compare.py)이 작업 루트에 남기는 검증 파일 allowlist.
export const VERIFY_FILES = [
  "side_by_side.png",
  "diff_heat.png",
  "figma_full.png",
  "my_full.png",
] as const;

export type VerifyFileName = (typeof VERIFY_FILES)[number];

export function isVerifyFile(name: string): name is VerifyFileName {
  return (VERIFY_FILES as readonly string[]).includes(name);
}

/** 존재하는 검증 파일 이름 목록. */
export function listVerifyFiles(jobId: string): VerifyFileName[] {
  try {
    const base = workDir(jobId);
    return VERIFY_FILES.filter((name) => existsSync(path.join(base, name)));
  } catch {
    return [];
  }
}
