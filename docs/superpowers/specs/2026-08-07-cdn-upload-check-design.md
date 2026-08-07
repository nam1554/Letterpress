# CDN 업로드 검증 — 설계 (2026-08-07)

## 배경

발송 준비(SendPrep)는 URL 템플릿으로 `hosted/` 교체본을 만들지만, `images/`를
실제 CDN(MinIO → Cantaloupe IIIF)에 올리는 것은 사람 손이다. 업로드 자동화는
자격증명 배포 문제 때문에 하지 않기로 결정(사용자 결정, 2026-08-07) — 대신
**"올라갔는지"의 검증을 자동화**한다. 수동 업로드의 실제 고통은 업로드 행위가
아니라 빠뜨림·오타·확인 노동이다.

사내 인프라 사실관계(노션 "첨부파일처리(minio&ftp)" + Jira AIP-24):
- IIIF URL은 읽기 전용, 실제 저장소는 MinIO(S3 호환).
- 오브젝트 키 규칙: 폴더 구분자 `/`를 `__`로 바꾼 평탄한 이름
  (예: `aisurfer/edm/hero.jpg` → `aisurfer__edm__hero.jpg`).

## 동작

1. "교체본 생성" 성공 직후 자동 1회 검사 + 결과 옆 "다시 확인" 버튼.
2. 검사 대상은 hosted HTML 재파싱이 아니라 **`lib/hosting.ts`가 만든
   파일↔URL 매핑을 재사용** — 교체와 검증이 같은 로직에서 나오므로 어긋날 수
   없다.
3. 서버에서 각 URL에 HEAD(405/501이면 GET 폴백), 타임아웃 3초, 동시 5개.
4. 판정 3분류, 오진 방지가 핵심:
   - `live` — 2xx
   - `missing` — 4xx/5xx 응답 (서버는 닿았는데 파일이 없음)
   - `unreachable` — 타임아웃·DNS·연결 거부 (서버에 못 닿음)
   전부 `unreachable`이면 "CDN에 연결할 수 없습니다 (사내망/VPN 확인)"로
   미업로드와 구분해 표시한다.
5. `missing` 파일에는 로컬 파일명과 함께 **업로드해야 할 오브젝트 키**
   (URL 템플릿의 `{folder}__{file}` 부분을 앱이 계산)를 CommandChip으로
   복사 가능하게 보여준다.
6. 모두 live면 요약 배지 "CDN 이미지 N/N 확인됨". 어떤 상태도 발송을 막지
   않는다 — 정보만 준다.

## 구현 형태 (저장소 기존 패턴)

- `lib/hosting-check.ts` — 순수 로직. `checkHostedUrls(entries, fetcher, opts)`
  형태로 fetcher 주입식이라 네트워크 없이 유닛 테스트 가능
  (`hosting-check.test.ts`: 3분류, HEAD→GET 폴백, 동시성 캡, 타임아웃,
  전부-unreachable 요약).
- `lib/hosting.ts` — 파일↔URL 매핑을 내보내는 순수 함수 추출(기존 치환
  로직에서 도출; 치환 결과는 불변).
- `GET /api/jobs/:id/hosting/check` — hosted/가 없으면 400. 라우트 유닛 테스트.
- `app/jobs/[id]/SendPrep.tsx` — 결과 목록 섹션 + 자동 검사 + 다시 확인.
  요청은 기존 `requestJson` 경유.

## 하지 않는 것 (YAGNI)

- 업로드 자체·자격증명 저장 (결정으로 제외)
- 검사 결과 영속화 (네트워크 상태는 변한다 — 매번 재검사)
- 폰트 CDN URL 검사 (이미지 아님)
- 발송 차단 (정보 제공만)

## 참고

- 로컬 단일 사용자 도구라 서버가 사용자 설정 URL로 요청하는 SSRF 표면은
  수용한다 (템플릿은 이미 설정에 저장되는 값이다).
