import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerNodeProblemLog } from "./instrument-node";

/**
 * 프로세스 수준 핸들러는 한 번만 붙어야 한다.
 *
 * 왜 신경 쓰나: 중복 등록되면 오류 하나가 진단 로그에 N번 적힌다. 그 파일은
 * 비개발자 팀원이 "무엇이 문제인지 직접 알아낼 필요 없이" 담당자에게 보내는
 * 물건이라, 같은 오류가 여러 번 찍히면 담당자가 반복 발생으로 읽는다.
 * Node도 리스너 11개부터 MaxListenersExceededWarning을 띄운다.
 *
 * `lib/jobs/live.ts`는 이미 같은 이유로 globalThis 가드를 두고 있다
 * (Next dev HMR이 모듈을 다시 평가한다).
 */
const SIGNALS = ["unhandledRejection", "uncaughtException"] as const;
const guard = globalThis as unknown as { __mhmProblemLogHooked?: boolean };

/**
 * `process.listeners`/`removeListener`의 타입 오버로드가 신호 이름(Signals)으로
 * 좁혀져 있어 'unhandledRejection' 같은 이벤트 이름은 통과하지 못한다.
 * 런타임은 문제없으므로 여기서만 넓혀 쓴다.
 */
type Listener = (...args: unknown[]) => void;
const emitter = process as unknown as {
  listeners(event: string): Listener[];
  removeListener(event: string, listener: Listener): void;
};

const counts = () => SIGNALS.map((s) => process.listenerCount(s));

let baseline: number[] = [];

beforeEach(() => {
  // 각 케이스를 "아직 등록 안 된" 상태에서 시작한다.
  guard.__mhmProblemLogHooked = false;
  baseline = counts();
});

afterEach(() => {
  // 이 파일이 붙인 핸들러를 걷어낸다 — 남기면 같은 워커의 다른 테스트가
  // 영향을 받는다.
  SIGNALS.forEach((s, i) => {
    for (const l of emitter.listeners(s).slice(baseline[i])) {
      emitter.removeListener(s, l);
    }
  });
  guard.__mhmProblemLogHooked = false;
});

describe("registerNodeProblemLog", () => {
  it("첫 호출에는 실제로 등록한다", () => {
    registerNodeProblemLog();
    counts().forEach((n, i) => expect(n, SIGNALS[i]).toBeGreaterThan(baseline[i]));
  });

  it("여러 번 불러도 핸들러가 쌓이지 않는다", () => {
    registerNodeProblemLog();
    const once = counts();

    registerNodeProblemLog();
    registerNodeProblemLog();

    expect(counts()).toEqual(once);
  });
});
