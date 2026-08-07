"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 2단계 확인(무장) 상태 — 첫 클릭은 무장만 하고, 유예 시간 안의 두 번째
 * 클릭만 실행한다. 뷰어의 되돌리기에서 시작된 패턴을 공용화한 것:
 * 무장 후 한참 지난 클릭이 확인 없이 바로 실행되는 것을 막기 위해
 * 유예(기본 4초)가 지나면 자동 해제된다.
 *
 * 키는 "무엇에 대한 확인인가"를 식별한다 — 행 목록이면 행 id, 선택 삭제면
 * 선택 시그니처(id 조인). 키가 바뀐 뒤의 클릭은 실행이 아니라 새 무장이
 * 된다(확인은 "그 대상"에만 유효하다). 한 인스턴스 안에서는 무장이 하나뿐이라
 * 다른 키를 무장하면 이전 무장은 풀린다.
 */
export function useArmedConfirm(timeoutMs = 4000) {
  const [armedKey, setArmedKey] = useState<string | null>(null);

  useEffect(() => {
    if (armedKey === null) return;
    const t = setTimeout(() => setArmedKey(null), timeoutMs);
    return () => clearTimeout(t);
  }, [armedKey, timeoutMs]);

  /** 무장 상태의 두 번째 클릭이면 해제하고 true(실행), 아니면 무장하고 false. */
  const fire = useCallback(
    (key = "confirm"): boolean => {
      if (armedKey === key) {
        setArmedKey(null);
        return true;
      }
      setArmedKey(key);
      return false;
    },
    [armedKey],
  );

  const isArmed = useCallback((key = "confirm") => armedKey === key, [armedKey]);
  const disarm = useCallback(() => setArmedKey(null), []);

  return { fire, isArmed, disarm };
}
