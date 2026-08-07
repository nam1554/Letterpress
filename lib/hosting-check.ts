import { renderCdnUrl } from "./hosting";

/**
 * CDN 업로드 검증 — 업로드는 사람이 하고(자격증명을 배포하지 않기로 한 결정),
 * "올라갔는지"만 앱이 확인한다. 검사 대상 URL은 hosted/ 치환이 쓴 것과 같은
 * renderCdnUrl에서 나오므로 교체본과 검증이 어긋날 수 없다.
 */
export type UrlState = "live" | "missing" | "unreachable";

export interface HostedEntry {
  file: string;
  url: string;
  /** 수동 업로드용 MinIO 오브젝트 키 — 템플릿이 `{folder}__{file}` 규칙일 때만. */
  uploadKey: string | null;
}

export interface UrlCheck extends HostedEntry {
  state: UrlState;
  status: number | null;
}

export interface HostingCheckSummary {
  checks: UrlCheck[];
  live: number;
  missing: number;
  /** 서버에 닿지 못한 수 — 미업로드(404)와 반드시 구분해 안내한다. */
  unreachable: number;
  /** 하나도 닿지 못함 → "미업로드"가 아니라 망(사내망/VPN) 문제로 안내. */
  allUnreachable: boolean;
}

export type ProbeFetcher = (
  url: string,
  method: "HEAD" | "GET",
  signal: AbortSignal,
) => Promise<{ status: number }>;

/**
 * 사내 CDN(IIIF)의 실제 업로드 대상은 MinIO 오브젝트이고, 키는 폴더 구분자
 * `/`를 `__`로 바꾼 평탄한 이름이다. 템플릿이 그 규칙(`{folder}__{file}`)을
 * 쓸 때만 키를 계산한다 — 다른 모양의 템플릿에서 키를 지어내면 오히려
 * 잘못된 이름으로 올리게 만든다.
 */
export function uploadKeyFor(template: string, file: string, folder: string): string | null {
  if (!folder || !template.includes("{folder}__{file}")) return null;
  return `${folder}__${file}`;
}

export function hostedEntries(files: string[], template: string, folder: string): HostedEntry[] {
  return files.map((file) => ({
    file,
    url: renderCdnUrl(template, file, folder),
    uploadKey: uploadKeyFor(template, file, folder),
  }));
}

export interface CheckOptions {
  timeoutMs?: number;
  concurrency?: number;
}

async function probe(
  entry: HostedEntry,
  fetcher: ProbeFetcher,
  timeoutMs: number,
): Promise<UrlCheck> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let res = await fetcher(entry.url, "HEAD", signal);
    // 일부 서버는 HEAD를 막는다 — 그 응답으로 미업로드를 판정하면 오진이다.
    if (res.status === 405 || res.status === 501) {
      res = await fetcher(entry.url, "GET", signal);
    }
    const live = res.status >= 200 && res.status < 300;
    return { ...entry, state: live ? "live" : "missing", status: res.status };
  } catch {
    return { ...entry, state: "unreachable", status: null };
  }
}

export async function checkHostedUrls(
  entries: HostedEntry[],
  fetcher: ProbeFetcher,
  opts: CheckOptions = {},
): Promise<HostingCheckSummary> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  const checks: UrlCheck[] = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= entries.length) return;
      checks[i] = await probe(entries[i], fetcher, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));

  const live = checks.filter((c) => c.state === "live").length;
  const missing = checks.filter((c) => c.state === "missing").length;
  const unreachable = checks.filter((c) => c.state === "unreachable").length;
  return {
    checks,
    live,
    missing,
    unreachable,
    allUnreachable: checks.length > 0 && unreachable === checks.length,
  };
}
