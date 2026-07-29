# 품질 게이트 — "어떤 링크든 동일 품질" 설계 문서

날짜: 2026-07-29
상태: 자율 실행 모드로 확정 (사용자 요청: "개선점을 추출하고 개선해줘" — 결정 사항은 본 문서에 기록)

## 문제

앱의 목표는 어떤 Figma 링크를 넣어도 **동일한 품질**의 이메일 HTML이 나오는 것.
현재 구조는 그 품질을 에이전트의 자기 보고에 전적으로 맡긴다:

1. **품질 게이트 부재** — `claude-code.ts`는 CLI exit 0 + stream-json
   `result: success`만 보고 잡을 성공 처리한다. `output/`이 비어 있어도,
   픽셀 검증을 건너뛰었어도, 검증이 FAIL이어도 "완료"가 된다.
2. **검증 결과가 기계 판독 불가** — `compare.py`는 PASS/FAIL을 stdout에만
   출력한다. 앱은 비교 이미지 4장을 보여줄 뿐 결과 자체를 모른다
   (tool 결과는 이벤트 스트림에 실리지 않으므로 로그 grep도 불가).
3. **실패 시 복구 없음** — 에이전트가 중간에 산출물 일부만 남기고 끝나면
   그대로 끝. 재실행은 빈 workDir에서 처음부터(수동, 전체 비용).
4. **엣지 URL 처리** — 브랜치 URL(`/design/KEY/branch/BKEY/...`)은 본 파일
   키로 잘못 파싱되고 title이 "branch"가 된다. node-id 없는 URL일 때 어떤
   프레임을 변환할지 프롬프트에 규칙이 없어 결과가 비결정적이다.

## 검토한 접근

- **A. 프롬프트만 강화** — 비용 0이지만 여전히 에이전트 신뢰 기반. 기각.
- **B. 수용 게이트 + 자동 보수 1회 + verify.json (채택)** — 앱이 파일시스템에서
  산출물 계약과 검증 결과를 직접 확인하고, 미달 시 실패 항목만 명시해 같은
  workDir에서 한 번 더 보수 실행. 결정적이고 비용 증가는 실패 케이스에 한정.
- **C. 앱이 compare.py를 직접 재실행** — 가장 결정적이지만 앱 프로세스에
  Python/PIL/Chrome 의존성이 들어오고 스킬 로직이 이중화된다. 기각.

## 설계 (B)

### 1. `compare.py`가 `verify.json`을 쓴다 (스킬 보강)

`~/.claude/skills/figma-edm/scripts/compare.py`가 기존 이미지 산출물에 더해
`$EDM_DIR/verify.json`을 쓴다:

```json
{
  "result": "PASS" | "FAIL",
  "overall": 97.31,
  "mean_delta": 1.2,
  "height_delta": 3,
  "bands": [{ "name": "header", "sim": 99.2, "shift": 0, "ok": true }]
}
```

에이전트가 별도 파일을 쓸 필요 없이 파이프라인의 필수 단계(compare.py 실행)가
곧 기계 판독 가능한 판정을 남긴다. 모든 백엔드(claude/gemini/codex)가 같은
스크립트를 쓰므로 공통 적용.

### 2. 수용 게이트 — `lib/jobs/acceptance.ts`

`checkAcceptance(jobId)` → `{ ok, failures: string[], warnings: string[], verify }`.

실패(= 잡 실패) 조건:
- `output/*_figma.html` 없음 · `output/*_responsive.html` 없음
- 검증 증거물 부재: workDir 루트에 `figma_full.png` / `my_full.png` /
  `side_by_side.png` 없음 (검증을 아예 안 돌린 것)
- `verify.json` 없음, 파싱 불가, 또는 `result !== "PASS"`

경고(성공은 유지, 리포트만):
- `output/images/` 비었거나 없음 (텍스트-온리 디자인 가능성)

`readVerifySummary(jobId)`는 관용적으로 파싱해 `Job.verify`에 저장할 요약을
돌려준다.

### 3. 러너에 게이트 + 자동 보수 1회 — `runner.ts`

```
provider.run → (ok?) → checkAcceptance
  → 통과: succeeded (+ Job.verify 저장)
  → 미달: status 이벤트로 실패 항목 공지
          → provider.run(task + repair:{failures})  … 1회, 같은 workDir
          → checkAcceptance 재실행 → 통과: succeeded / 미달: failed(사유 나열)
```

- 보수 조건: 원 실행 ok && 게이트 미달 && !aborted/!timeout && !promptOverride.
- 타임아웃/AbortController는 잡 전체에 하나 — 보수도 같은 시한 안에서 돈다.
- mock 프로바이더도 게이트를 통과해야 한다(verify.json 포함 산출) — E2E 루프가
  게이트까지 검증하게 됨.

### 4. 프롬프트 계약 명문화 — `prompt.ts`

- 산출물 계약에 검증 증거물 명시: `figma_full.png`·`my_full.png`·
  `side_by_side.png`·`diff_heat.png`·`verify.json`은 workDir 루트에 남길 것,
  앱이 이를 검사해 미달 시 거부한다는 사실 포함.
- node-id 없는 URL: 파일의 최상위 프레임을 나열해 이메일 디자인 프레임
  (세로형, 폭 ~600–800px)을 선택하고 선택 사실을 로그로 남긴다. 후보가 없으면
  프레임 목록과 함께 `FATAL:`.
- `task.repair`가 있으면 "REPAIR run" 부록을 덧붙인다: 이전 시도의 실패 항목
  나열 + 기존 중간 산출물 재사용 + 실패 항목만 고치고 verify 재실행.

`AgentTask`에 `repair?: { failures: string[] }` 추가 (providers는 변경 불요 —
buildEdmPrompt가 처리).

### 5. URL 견고성 — `figma.ts`

- 브랜치 URL `/design/KEY/branch/BKEY/Title` → fileKey는 BKEY, title은 브랜치
  뒤 슬러그. (브랜치 내용은 본 파일 키로는 접근 불가하므로 현재는 오변환됨)
- 기존 `/design|file|proto` 지원 유지, board/slides는 계속 거부.

### 6. UI 표면화

- `Job.verify` (result/overall/heightDelta)를 상세 API가 그대로 내려줌.
- `VerifyReport` 아코디언 헤더에 PASS/FAIL 배지 + overall 유사도 표기.
- 게이트 실패 사유는 기존 summary Alert로 노출(러너가 summary에 나열).

## 테스트

- `acceptance.test.ts`: tmp MHM_DATA_DIR에 파일 조합을 만들어 게이트 판정 검증
  (전부 있음/HTML 누락/verify FAIL/verify.json 없음/images 경고).
- `figma.test.ts`: 브랜치 URL 파싱 케이스 추가.
- 러너 보수 루프: mock 수준 단위 검증은 acceptance + prompt 조립 함수로 커버,
  전체 루프는 mock 프로바이더 E2E로 확인.
- 기존 스위트 + `tsc --noEmit` + `lint` + `build`.

## 트레이드오프 / 결정

- **보수 1회 고정** (설정 아님): 무한 재시도로 인한 토큰 폭주 방지. 2회 이상
  필요하면 사용자가 "다시 실행" — 이때 새 잡은 빈 workDir이므로 전체 재실행.
- **verify FAIL은 잡 실패로 처리**: "동일 품질" 약속이 제품의 핵심이므로
  근사-통과를 성공으로 포장하지 않는다. 산출물은 실패 잡에서도 다운로드 가능
  (ArtifactList는 status와 무관하게 표시됨).
- **스킬(`~/.claude/skills/figma-edm`) 수정 포함**: 레포 밖이지만 품질 엔진
  본체. verify.json 추가는 순수 추가적 변경으로 기존 사용 흐름을 깨지 않는다.
