# 뷰어 인라인 편집 설계 (2026-08-07)

사용자 요청: "생성된 HTML을 UI 뷰어로 보고 텍스트나 스타일을 직접 수정하고 싶다."

이미 있는 것: 읽기 전용 뷰어(`app/jobs/[id]/view/page.tsx` — iframe + 폭 전환 +
HTML 복사)와 same-origin 프리뷰 라우트(`/api/jobs/:id/preview/[...path]`).
이 위에 편집을 얹는다. 기존 에이전트 기반 수정(`POST /api/jobs/:id/edit`)을
대체하는 게 아니라, **재실행 없이 즉석에서 고치는 빠른 길**이다 — 오타·문구·
간단한 스타일은 몇 초에 끝나야 하고, 레이아웃급 변경은 여전히 에이전트 몫.

## 범위 (합의됨)

- **텍스트 + 간단 스타일만**: 글자색 · 글자 크기 · 굵기 · 배경색. 여백/정렬/
  이미지 교체는 범위 밖(에이전트 수정으로 안내).
- **보고 있는 파일만 수정**: `_figma.html`을 고쳐도 `_responsive.html`은 그대로.
  두 파일이 어긋날 수 있음을 UI 안내 문구로 알린다.
- **덮어쓰기 + 원본 1회 백업**: 첫 저장 때만 원본을 백업하고 "원본으로
  되돌리기" 제공. 이후 저장은 계속 덮어쓴다.
- **WYSIWYG**: iframe 본문을 직접 타이핑, 요소 선택 시 미니 스타일 패널.

## 1. 저장 API — `PUT /api/jobs/:id/artifact` (신규)

- 바디는 zod로 `readBody(req, schema)` 경유:
  `{ file: string, html: string }` 또는 `{ file: string, restore: true }`.
- 경로 규칙: `resolveArtifact`로 확인하고, **output 최상위의 `.html`만 허용**.
  - `hosted/` 하위: 호스팅 라우트가 요청 시점에 최상위 파일에서 재생성하므로
    편집해도 다음 재생성에 덮인다 — 거부.
  - `images/` 등 비-HTML: 거부.
- 잡이 `queued`/`running`이면 **409** — 에이전트가 쓰는 중인 파일과 충돌 방지.
  (UI에서도 막지만 서버가 최종 권위.)
- **백업**: 첫 저장 시 원본을 `work/edit-backup/<file>`에 복사. `output/` 밖에
  두는 이유 — `listArtifacts()`가 output을 재귀 순회하므로, 안에 두면 백업이
  산출물 목록과 다운로드 zip에 섞인다. 백업 복사가 실패하면 저장 자체를
  중단한다(원본 보존이 저장보다 우선).
- **restore**: `edit-backup/<file>`을 output으로 복사해 원복. 백업이 없으면 404.
- 저장/restore 후 `invalidateJobSize(id)` (호스팅 라우트와 같은 이유 —
  `store.ts`의 크기 캐시는 (id, status) 키라 외부 쓰기를 모른다).
- `job.json`에 `manualEdits?: Record<string, number>` (파일 → 마지막 수정
  시각) 기록. **restore 시 해당 파일의 엔트리를 제거**한다 — 원본으로 돌아간
  파일에 "수동 수정됨" 배지가 남으면 거짓말이다.
- 바디 크기: 산출물은 base64 Pretendard 폰트 때문에 수 MB일 수 있다.
  App Router 라우트 핸들러에는 pages/api의 1MB bodyParser 제한이 없으므로
  추가 설정 불필요(확인 사항으로 명시해 둔다).

## 2. 뷰어 편집 모드 — `view/page.tsx` 확장

- 상단바에 [편집] 토글 + [저장] + (백업 존재 시) [원본으로 되돌리기].
- **편집 토글은 output 최상위 `.html`을 볼 때만 노출** — 저장 API의 허용
  규칙과 동일 조건.
- 뷰어가 잡 상태를 알아야 한다: 기존 fetcher/SWR로 `/api/jobs/:id`를 읽어
  `queued`/`running`이면 편집 토글 비활성 + 사유 표시. (현재 뷰어는 잡을
  전혀 읽지 않는다 — 이번에 추가.)
- 편집 켜면 same-origin iframe 문서의 `body.contentEditable = "true"`.
- **미니 스타일 패널**: iframe의 `selectionchange`를 구독해 선택 영역의
  bounding rect + iframe 오프셋으로 부모 페이지에 오버레이로 띄운다.
  색·크기·배경은 선택 지점에서 가장 가까운 요소의 인라인 스타일을 수정,
  굵기는 선택 범위에 적용. 구체 메커니즘(execCommand vs span 래핑)은
  구현 계획에서 확정.
- **직렬화**: `<!doctype ...>`(document.doctype에서 복원) +
  `documentElement.outerHTML`. 전송 전에 편집용 흔적(contentEditable 속성,
  주입한 도우미 속성/클래스)을 벗긴다 — 이 정리 로직은 **순수 함수로 분리**
  (`app/lib/serialize-edited.ts` 같은 위치)해 유닛 테스트.
- **미저장 이탈 경고**: `beforeunload` + 앱 내 내비게이션("← 작업으로" 앵커,
  파일 전환) 양쪽 모두 확인을 거친다. 폭 전환(SegmentedControl)은 iframe을
  리로드하지 않으므로 안전 — 확인 불필요.
- 저장 성공/실패는 `app/lib/request.ts`의 `sendJson` 경유(맨 fetch 금지 —
  프로젝트 규칙). 실패해도 편집 내용은 iframe에 남아 재시도 가능.

## 3. 정합성 표시

- `manualEdits`가 있으면 작업 페이지(ArtifactList 또는 VerifyReport 옆)에
  "수동 수정됨" 배지 + 안내: 픽셀 검증 결과는 수정 전 기준이고, 다른 산출물
  파일과 어긋날 수 있다.
- `hosted/` 변형과 email-check(`GET /api/jobs/:id/check?file=`)는 요청 시점에
  현재 파일을 읽으므로 편집 후 다시 실행하면 자동 반영 — 추가 작업 없음.
- **resume와의 상호작용(문서화만)**: resume는 같은 workDir를 재사용하므로
  실패 잡을 수동 편집한 뒤 resume하면 에이전트가 편집을 덮을 수 있다.
  수동 편집은 대부분 성공 잡에서 일어나고 resume는 실패 잡 전용이라 교집합이
  좁다 — 막지 않고 받아들인다. 편집 잡(`/edit`)은 work/를 새 잡으로 복사하니
  `edit-backup/`도 따라가지만 무해하고, 새 job.json이라 `manualEdits`는
  복사되지 않는다(의도대로).

## 4. 알려진 트레이드오프

- **DOM 왕복 정규화**: 브라우저 파싱을 거치므로 저장본이 원본과 바이트 단위로
  같지 않다(`<tbody>` 자동 삽입, 속성 정리 등). Outlook 조건부 주석
  (`<!--[if mso]>`)은 DOM 주석 노드로 보존된다. 이메일 클라이언트 호환성이
  의심되면 email-check를 다시 돌리는 것으로 방어.
- 수동 편집은 픽셀 검증을 우회한다. verify 배지는 수정 전 기준임을 표시할 뿐
  재검증하지 않는다(재검증하려면 잡 재실행).

## 5. 테스트

- 라우트 유닛(`artifact/route.test.ts`, 기존 라우트 테스트 패턴):
  경로 탈출/비-HTML/hosted 거부, running 409, 백업은 첫 저장에만 생성,
  restore 왕복(내용 원복 + `manualEdits` 엔트리 제거), 존재하지 않는 백업
  restore 404.
- 직렬화 정리 순수 함수 유닛: contentEditable/도우미 속성 제거, doctype 보존,
  조건부 주석 보존.
- E2E는 mock provider + 스크래치 데이터 디렉터리(기존 패턴). 단, rAF 기반
  검증 함정(AGENTS.md)에 유의 — 편집 UI에 애니메이션을 넣지 않는다.
