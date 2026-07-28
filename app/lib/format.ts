/** "3분 전" 스타일 상대 시각 — 히스토리 목록용. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(ts).toLocaleDateString("ko-KR");
}

/** Figma URL에서 표시용 짧은 라벨 (fileKey 앞 8자 + node-id). */
export function figmaLabel(url: string): string {
  try {
    const u = new URL(url);
    const key = u.pathname.match(/\/design\/([A-Za-z0-9]+)/)?.[1] ?? "";
    const node = u.searchParams.get("node-id");
    return `${key.slice(0, 8)}…${node ? ` · node ${node}` : ""}`;
  } catch {
    return url;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}
