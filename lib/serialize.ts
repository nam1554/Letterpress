/**
 * 키별 직렬화 큐 — 같은 키로 들어온 비동기 작업을 도착 순서대로 실행한다.
 * updateJob의 lost-update 방지(store.ts)와 뷰어 저장/복원의 백업 TOCTOU
 * 방지(artifact 라우트)가 같은 알고리즘을 각자 들고 있었다 — 미묘한 지점이
 * 두 벌이면 다음 경쟁 조건 수정이 한쪽에만 반영된다(티어드 리뷰 지적).
 *
 * 미묘한 지점 두 가지, 고칠 때 반드시 유지할 것:
 * - `run.catch(() => {})`를 **저장 전에** 붙인다 — 실패한 작업의 rejected
 *   promise를 그대로 큐에 남기면 이후 모든 대기자가 그 오류를 물려받는다.
 *   호출자에게는 원래의 `run`을 돌려줘 실패를 정상적으로 전파한다.
 * - 엔트리 삭제는 `locks.get(key) === tail`일 때만 — 내가 끝난 사이 새
 *   대기자가 엔트리를 교체했다면, 무조건 삭제가 그 대기자의 큐를 끊어
 *   다음 작업부터 직렬화가 사라진다.
 *
 * 락 도메인(Map)은 호출자가 소유한다 — updateJob의 쓰기 큐와 artifact의
 * 파일 락은 서로 다른 도메인이라 중첩 획득해도 교착이 없다(전자는 후자를
 * 기다리는 일이 없다). 프로세스 내 큐로 충분한 이유는 앱이 단일 서버
 * 프로세스이기 때문이고, dev HMR 리로드에서 살아남도록 Map은 호출자가
 * hmrGlobal 등으로 보관한다.
 */
export function withKeyedLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  void tail.finally(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}
