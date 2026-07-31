# 구독 무관 동일 합격선 — 백엔드 로스터 재정비 설계 (2026-07-31)

사용자 요구: "어떤 구독을 사용하더라도 동일한 목표, 결과물이 나오길 원한다.
팀원에게 전달했을 때 구독제가 있다면 누구든 적절 수준의 eDM을 생성할 수 있게."

대상 백엔드는 사용자가 보유한 두 구독 — ChatGPT(Codex CLI)와
Google(Antigravity CLI, `agy`) — 그리고 기존 `claude-code`.

## 1. 진단

### (a) 합격선은 이미 백엔드 공통이다

품질 게이트(`lib/jobs/acceptance.ts` + `lib/jobs/measure.ts`)는 에이전트의
자기보고를 보지 않고 파일시스템과 실제 브라우저 측정으로 판정한다. 따라서
"구독이 뭐든 합격선이 같다"는 이미 구조적으로 참이다. 새로 만들 장치가 아니다.

### (b) 진짜 구멍은 "합격선에 도달 못 하는 백엔드"의 처리다

백엔드 상태는 셋 중 하나다.

| 상태 | 현재 동작 | 팀원 입장 |
|---|---|---|
| ① 통과 | 정상 | 문제 없음 |
| ② 우회 시도 | 게이트가 잡음 → 자동 복구 1회 → 재판정 | 잘 동작함 |
| ③ 완주 불가 (쿼터·타임아웃) | 실패 메시지 | **원인도 대안도 모름** |

`gemini`가 정확히 ③인데 목록에 그대로 올라와 있다. 코드는 완비(프로바이더
6.2KB + 진단 + 설정 + 스모크 테스트)인데 실전 완주 기록이 0건이다. 팀원이
그것을 고르면 15분 뒤 영문 모를 실패를 받는다. **미검증 백엔드를 목록에
올려두는 것 자체가 함정이다.**

### (c) codex의 "실패 기록"은 현재 가드레일에서 측정된 것이 아니다

`data/jobs/`의 codex 잡 3건과 게이트 커밋의 타임스탬프가 교차한다.

```
17:29  codex 492f5aa4   통짜 이미지 1장 (HTML 1.2KB, 이미지 1장, 라이브 텍스트 0자)
17:35  ff8efc3          "통짜 이미지 통과시키던 구멍 — 라이브 텍스트 최소량 요구"
17:38  codex 00ae9d9a   sr-only 숨김 텍스트 (clip:rect(0,0,0,0), 1px)
17:43  5c4ca3a          "우회 2탄 차단 — 숨김 텍스트 불인정 + 페이지 스크린샷 거부"
17:46  codex ec4b0db9   7조각 슬라이스 (header/hero/intro/cards/banner/closing/footer)
17:54  f989e44          "우회 3탄 차단 — 클래스 숨김·투명 텍스트 + 슬라이스 커버리지 한도"
```

세 번 모두 **대응책이 생기기 전에** 실행됐다. 현재 `lib/providers/prompt.ts`
58~71줄은 게이트 규칙 3종을 본문에 명시하고 "there is no shortcut past this
gate"로 끝나는데, codex는 이 프롬프트로 한 번도 실행된 적이 없다.

즉 codex의 상태는 "쓸 수 없음"이 아니라 **"현재 가드레일에서 미측정"**이다.

참고로 세 잡의 `verify.json`은 모두 PASS 99.97~100%였다. 픽셀 검증만으로는
셋 다 납품됐을 것이다 — 게이트의 존재 이유이자, 새 백엔드를 싸게 시험할 수
있는 근거다.

### (d) Antigravity CLI는 인터페이스가 맞지만 쿼터가 위험하다

`agy` v1.1.8 기준 (공식 headless 문서 · CHANGELOG 확인):

| 이 프로젝트의 요구 | `agy` |
|---|---|
| 헤드리스 실행 | `-p` / `--print` |
| 줄 단위 JSON 스트림 | `--output-format stream-json` (v1.1.8 신규) |
| 승인 프롬프트 없음 | `--dangerously-skip-permissions` |
| 모델 고정 | `--model <slug>` (+ `--effort`) |
| Figma MCP | `~/.gemini/config/mcp_config.json` |

`stream-json`은 `init` / `step_update` / `result` 3종이 타입 지정돼 있어
현재 `gemini.ts`의 관용 매칭(툴 이벤트 스키마 미관측으로 `type.includes("tool")`)
보다 깨끗한 파서가 가능하다.

리스크 둘:
- **쿼터.** Antigravity는 데스크톱 앱·CLI·SDK가 쿼터를 공유하고, 서브에이전트를
  병렬로 띄운다. Google AI Pro에서 2시간 사용 후 5시간 락이 걸린 사례가 보고돼
  있다. 사용자 등급이 **Pro**이므로 정면으로 해당된다. 이 프로젝트 잡 1건은
  15분 풀 파이프라인이다.
- **기본 `--print-timeout` 5분.** 실측 15분 파이프라인이므로 연장하지 않으면
  100% 중간에 잘린다.

(참고: `-p`가 비-TTY에서 stdout을 조용히 버리던 이슈 #76은 v1.0.10에서 수정됨.
이 앱은 execa로 파이프를 통해 스폰하므로 해당 조건이었다.)

## 2. 설계

### 2.1 `AgentProvider`에 검증 상태 추가

`ready`(런타임 진단)와 독립된 축을 만든다.

```ts
// lib/providers/types.ts — AgentProvider
/** 실전 잡 완주 기록. 코드 완성도가 아니라 측정 결과다. */
verification: "verified" | "unverified" | "sample";
/** 근거 한 줄. 예: "2026-07-30 실측 PASS 98.12%" */
verificationNote: string;
```

| | `ready` | `verification` |
|---|---|---|
| 성격 | 런타임 진단 (CLI·로그인·MCP) | 사람이 측정해 코드에 기록 |
| 팀원마다 | 다름 | 같음 |
| 판정 시점 | 매 조회 | 커밋 시 고정 |

- `verified` — 실제 Figma 잡을 끝까지 돌려 게이트 PASS를 확인함
- `unverified` — 코드는 있으나 완주 기록 없음 (선택 시 경고)
- `sample` — `mock` 전용

**규칙: 실전 PASS 확인 전에는 `verified`로 쓰지 않는다.** 문서·UI 어디에도
"지원한다"고 쓰지 않는다.

### 2.2 UI 노출

홈의 백엔드 `Select`(`app/page.tsx`)는 이미 `ready`를 라벨에 반영하고
(`· 설정 필요`), 미준비 선택 시 경고 Alert + 버튼 문구 전환을 한다.
`verification`을 같은 자리에 **다른 문구로** 추가한다. 두 경고는 원인이
다르므로 합치지 않는다 — "설정이 덜 됐다"와 "설정은 됐는데 완주 기록이 없다"는
팀원이 취할 행동이 다르다.

`BackendSetup` 패널에도 근거 한 줄(`verificationNote`)을 표시한다.

### 2.3 로스터 변경

최종: `claude-code` / `codex` / `antigravity` / `mock`.

**제거 (gemini)** — API 키 방식이라 "구독" 축과 무관하고, 완주 기록이 없으며,
`agy`가 `~/.gemini/` 설정을 공유해 진단이 혼선을 빚는다.
- `lib/providers/gemini.ts`, `gemini.smoke.test.ts`
- `lib/setup.ts`: `geminiSetup`, `figmaMcpFromGeminiList`, `GEMINI_BIN`
- `lib/settings.ts`: `geminiApiKey` (+ `lib/setup.ts`의 키 검증기)
- `registry.ts` 항목, `parsers.test.ts`/`setup.test.ts`의 관련 케이스
- `AGENTS.md`의 gemini 서술

기존 `data/settings.json`에 `geminiApiKey`가 남아 있어도 무시되고 저장 시
탈락하면 된다 (마이그레이션 코드는 두지 않는다).

**추가 (antigravity)** — `lib/providers/antigravity.ts`:

```
bin  : ANTIGRAVITY_BIN ?? "agy"
args : -p <prompt>
       --output-format stream-json
       --dangerously-skip-permissions
       --print-timeout <설정 jobTimeoutMs와 같은 값>
cwd  : task.workDir
env  : agentEnv()   // CHROME_BIN 포함
```

`--model` / `--effort`는 **초기 구현에 넣지 않는다** (§2.4). `claudeModel`에
대응하는 설정 항목도 만들지 않는다 — 필요성이 측정으로 드러나면 별건으로 다룬다.

- 라인 매퍼: `init` → status, `step_update` → log/tool (`step_type` 분기),
  `result` → 최종 응답/에러. 순수 함수로 분리해 `parsers.test.ts`에서 테스트.
- `loggedIn()`: 대화형 `agy` 세션의 캐시 자격증명을 확인한다. 정확한 경로는
  실제 설치 후 확정한다 (설계 단계에서 추측하지 않는다).
- `lib/setup.ts`: `agy mcp list` 출력 파서 + 진단 단계(설치/로그인/Figma 접근).
  파서는 실측 출력을 보고 작성한다.
- `agy` 스모크 테스트 (`RUN_ANTIGRAVITY_SMOKE=1`).

### 2.4 백엔드별 보정은 측정 후에만

복구 런 횟수, 프롬프트 차등, `--effort`, 모델 선택 같은 보정은 **이번 설계에
포함하지 않는다.** 무엇이 실제로 문제인지 모르는 상태에서 여러 개를 동시에
바꾸면 실패 원인을 가릴 수 없다. 3~4단계 측정 결과가 요구할 때만 별건으로
다룬다.

예외: `--print-timeout` 연장은 문서화된 기본값(5분) < 실측 소요(15분)이므로
측정 없이 확정 사항이다.

## 3. 실행 순서

측정을 앞에 두어, 쿼터로 못 쓸 백엔드에 프로바이더를 짜는 낭비를 막는다.
(gemini에서 이미 한 번 발생한 실수다.)

```
0. (사용자) agy 설치·로그인, codex login 확인
1. codex 재검증 ................. 코드 0줄. 실제 Figma 잡 1건 → 게이트 PASS?
2. antigravity 쿼터 생존 확인 .... 코드 0줄. 아래 방법으로 측정
3. 프로바이더 구현 + gemini 제거 .. 1·2 결과를 반영
4. antigravity 실전 1건 .......... 게이트 PASS?
5. verification 확정 + 문서 갱신 .. AGENTS.md, 메모리
```

1단계는 코드 변경이 없고 사용자 손도 `codex login` 하나인데, 이번 작업 절반의
답을 준다. 통과하면 codex 쪽은 문서 수정만으로 끝난다.

**2단계 측정 방법** (프로바이더 없이 손으로):
빈 작업 디렉터리에서 `buildEdmPrompt`가 만드는 것과 같은 eDM 프롬프트를
`agy -p ... --output-format stream-json --print-timeout 30m`으로 1회 실행한다.
같은 Figma 링크를 쓴다. 판정 항목은 셋이다.

1. **완주 여부** — 쿼터 소진/락 없이 끝까지 가는가
2. **소요 시간** — `--print-timeout` 을 얼마로 잡아야 하는가
3. **남은 쿼터** — 1건 후 데스크톱 앱이 여전히 쓸 만한가 (쿼터 공유 확인)

1이 실패하면 3~4단계를 건너뛰고 `unverified` 기록으로 마감한다.

## 4. 완료 기준

각 백엔드의 `verification` 값이 **측정으로** 확정되고, UI가 그것을 정직하게
표시하면 완료다.

**백엔드가 실패로 판명나도 완료다.** "antigravity는 Google AI Pro 쿼터로 완주
불가"가 측정되면 `unverified` + 근거 한 줄로 기록하고 선택 시 경고한다. 팀원이
그것을 골라 15분을 날리지 않게 되므로, 현재 gemini 상태보다 개선이다.

### 보장 범위의 한계 (명시)

게이트가 보장하는 것은 "정직하게 만든, 검증을 통과한 발송 가능한 eDM"이다.
백엔드가 다르면 verify 점수는 다를 수 있다(98% vs 96%). **픽셀 단위로 동일한
파일이 나오지는 않는다.** 사용자 확인 완료 (2026-07-31).

## 5. 검증

- 단위: 새 파서(`antigravity` 라인 매퍼, `agy mcp list`)를 `parsers.test.ts` /
  `setup.test.ts`에 추가. gemini 케이스 제거.
- 회귀: `pnpm vitest run`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.
- 실전: 1·2·4단계. 결과(소요 시간, 게이트 실패 수, verify %, 라이브 텍스트 수,
  이미지 수)를 `AGENTS.md`에 claude-code 실측치와 같은 형식으로 기록.
- 아카이브 회귀: `data/jobs/`의 기존 8건에 게이트를 재실행해 판정이 변하지
  않는지 확인 (로스터 변경이 게이트에 영향을 주지 않음을 보증).
