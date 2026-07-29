# 운영 편의 기능 — 설계

날짜: 2026-07-29 · 상태: 사용자 승인됨 (대화에서 동일 내용 승인)

로컬 단일 사용자 앱에서 잡이 쌓일 때의 운영 부담 3가지를 던다:
디스크가 얼마나 쓰이는지 모른다 · 지우려면 잡 상세에 하나씩 들어가야 한다 ·
10~25분짜리 변환이 끝나도 탭을 보고 있어야 안다.

## 1. 디스크 사용량 표시

- `lib/jobs/store.ts`에 `jobDirSize(id): Promise<number>` — 잡 디렉터리 재귀
  합산. **종료 상태 잡만** 모듈 레벨 `Map<string, number>`에 캐시(종료 잡은
  파일이 더 변하지 않는다). `deleteJob`이 캐시를 무효화한다. 실행 중 잡은
  매번 계산(개수가 적다).
- `GET /api/jobs` 응답의 각 잡에 `diskBytes: number` 추가.
- 홈 목록: 행마다 `12.3MB` 형식 표시, 목록 상단에 전체 합계.

## 2. 체크박스 선택 삭제

- 홈 잡 목록에 체크박스 + "선택 삭제(n)" 버튼 + "실패한 잡 모두 선택" 빠른
  선택. 실행 중 잡은 체크박스 비활성.
- `POST /api/jobs/bulk-delete` `{ids: string[]}` (zod, 1~200개) — 잡별로 기존
  `deleteJob()` 호출, `{results: [{id, ok, error?}]}` 반환. 실행 중 잡 거부
  등 부분 실패가 전체를 막지 않는다.
- 클라이언트는 `sendJson` 사용, 완료 후 목록 mutate. 삭제 전 확인은 버튼
  라벨의 개수 표시로 갈음한다(브라우저 confirm 모달 금지 — 자동화 차단 이슈).

## 3. 완료 시 macOS 알림

- `runner.ts`의 잡 종료 지점(성공·실패·타임아웃 공통)에서 서버가
  `osascript -e 'display notification ...'`을 spawn — 탭이 닫혀 있어도
  동작하고 브라우저 권한이 필요 없다. 실패도 알린다(더 알아야 할 정보).
- `settings.json`에 `notifyOnFinish: boolean`(기본 true), ⚙️ 패널 스위치.
- osascript 부재/실패는 조용히 무시(비-macOS 안전). 알림 실패가 잡 상태를
  건드리면 안 된다 — `appendEvent`와 같은 최선 노력 원칙.

## 4. 잡 목록 검색/필터

- 클라이언트 측만: 상태 칩(전체/실행 중/성공/실패) + 텍스트 검색(id·Figma
  URL·요약). 목록은 이미 전체가 로드된다. 새 API 없음.

## 테스트

- `bulk-delete` 라우트: 빈 배열 400 · 잘못된 id 형식 ok:false · 실행 중 잡
  거부 ok:false · 정상 삭제 후 디렉터리 부재 확인.
- `jobDirSize`: 종료 잡 캐시 적중(파일 추가 후에도 같은 값) · `deleteJob` 후
  무효화 · 실행 중 잡은 재계산.
- 알림: spawn을 목으로 — 종료 시 1회 호출, `notifyOnFinish: false`면 0회,
  spawn throw가 잡 상태에 영향 없음.

## 비범위

- 자동(기간 기준) 정리 — 수동 선택 삭제로 충분하다고 판단.
- 브라우저 Notification API — 서버 측이 더 단순하고 신뢰성이 높다.
- 잡 목록 페이지네이션 — 수백 개 규모까지는 필요 없다.
