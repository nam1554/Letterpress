import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { NextRequest } from "next/server";
import { bundleTexts, scrubForBundle } from "@/lib/diagnostics/bundle";
import { getJob, listArtifacts, listJobs, workDir } from "@/lib/jobs/store";

/**
 * GET /api/diagnostics[?job=<id>] → 문제 신고용 zip 한 개.
 *
 * 사용자가 data/ 폴더를 뒤져 파일을 골라 오게 하지 않는 것이 목적이다 —
 * 버튼 한 번으로 받아 그대로 전달하면 된다. 비밀값은 bundle.ts에서 지운다.
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  const jobs = await listJobs();
  const job = jobId ? await getJob(jobId) : null;

  const texts = await bundleTexts({ jobs, job });

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const pass = new PassThrough();
  // 에러 리스너가 없으면 archiver 실패가 프로세스를 죽인다.
  archive.on("error", (err) => pass.destroy(err));
  archive.pipe(pass);

  for (const [name, content] of Object.entries(texts)) {
    archive.append(content, { name });
  }

  if (job) {
    const base = workDir(job.id);
    // job.summary에는 CLI stderr 꼬리가 그대로 담긴다 — 인증 실패 로그에는
    // 요청 URL의 API 키나 토큰 헤더가 섞여 있을 수 있다.
    archive.append(scrubForBundle(JSON.stringify(job, null, 2)), { name: "job/job.json" });
    for (const file of ["verify.json", "events.ndjson"]) {
      // events.ndjson은 잡 디렉터리, verify.json은 작업 루트에 있다.
      const candidates = [path.join(base, file), path.join(base, "..", file)];
      for (const candidate of candidates) {
        const raw = await readFile(candidate, "utf8").catch(() => null);
        if (raw !== null) {
          archive.append(scrubForBundle(raw.slice(-500_000)), { name: `job/${file}` });
          break;
        }
      }
    }
    // 산출물은 목록만 — 용량이 크고, 실패 원인 파악에는 "무엇이 생겼는지"면 된다.
    const artifacts = await listArtifacts(job.id).catch(() => []);
    archive.append(
      artifacts.length === 0
        ? "(산출물 없음)"
        : scrubForBundle(artifacts.map((a) => `${a.rel}\t${a.size}바이트`).join("\n")),
      { name: "job/artifacts.txt" },
    );
  }

  void archive.finalize();

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  const name = job ? `letterpress-진단-${job.id}-${stamp}.zip` : `letterpress-진단-${stamp}.zip`;
  return new Response(Readable.toWeb(pass) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
