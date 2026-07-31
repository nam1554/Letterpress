# 구독 무관 동일 합격선 — 백엔드 로스터 재정비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원이 어떤 구독(ChatGPT/Codex · Google/Antigravity · Claude)을 갖고 있든 같은 합격선의 eDM을 얻게 하고, 합격선에 도달 못 하는 백엔드는 고르기 전에 알 수 있게 한다.

**Architecture:** 합격선 자체는 이미 `lib/jobs/acceptance.ts` 게이트가 백엔드 공통으로 강제한다. 이 계획이 더하는 것은 (1) `AgentProvider`에 측정으로만 올라가는 `verification` 축, (2) 그 값을 고르기 전에 보여주는 UI, (3) 로스터 교체(gemini 제거 · antigravity 추가). 코드 작업 앞뒤에 **코드 0줄짜리 측정 게이트**를 두어, 쿼터로 못 쓸 백엔드에 프로바이더를 짜는 낭비를 막는다.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Mantine v9 · vitest · execa(`jsonl-cli.ts`) · Antigravity CLI(`agy`) v1.1.8+ · Codex CLI

**Spec:** `docs/superpowers/specs/2026-07-31-multi-backend-parity-design.md`

## Global Constraints

- 최종 로스터: `claude-code` / `codex` / `antigravity` / `mock`. gemini는 완전 제거.
- **실전 PASS 확인 전에는 `verification: "verified"`로 쓰지 않는다.** 문서·UI 어디에도 "지원한다"고 쓰지 않는다.
- 백엔드별 보정(`--model`, `--effort`, 복구 런 횟수, 프롬프트 차등)은 **이번 계획에 넣지 않는다.** 예외: `--print-timeout`(문서화된 기본 5분 < 실측 15분).
- 새 파서는 **실측 출력**을 보고 쓴다. 추측 스키마로 커밋하지 않는다 (`gemini.ts`의 "실측 스키마 (v0.53, 2026-07-29 관측)" 주석이 선례).
- 검증 명령: `pnpm exec vitest run` · `pnpm exec tsc --noEmit` · `pnpm lint` · `pnpm build`. (package.json 스크립트는 rtk 훅이 재작성하지 않으므로 `pnpm exec` 형태를 쓴다.)
- 커밋 메시지는 한국어, 기존 컨벤션(`feat:` / `fix:` / `refactor:` / `docs:`)을 따른다.
- `data/`는 절대 커밋하지 않는다.

---

### Task 1: 측정 게이트 A — codex 재검증 (코드 0줄)

현재 프롬프트 + 게이트에서 codex가 정직한 빌드를 내는지 측정한다. 아카이브된 실패 3건은 모두 대응 커밋보다 **먼저** 실행된 것이라 현재 상태를 말해주지 않는다.

**Files:**
- 없음 (측정만)
- 기록: 이 계획 파일의 "측정 결과" 섹션에 追記

**Interfaces:**
- Consumes: 없음
- Produces: `CODEX_VERIFICATION` — Task 3의 `codexProvider.verification` / `verificationNote` 값

- [ ] **Step 1: 사전 조건 확인**

```bash
codex --version
codex login status
codex mcp list
```

기대: 셋 다 성공. `mcp list`에 `figma ... enabled` 행이 있을 것. 없으면
`codex mcp add figma --url https://mcp.figma.com/mcp` 후 브라우저 OAuth.

- [ ] **Step 2: 앱을 띄우고 codex로 잡 1건 실행**

```bash
pnpm dev
```

브라우저에서 `http://localhost:3000` → Figma eDM 링크 입력 → 백엔드 `codex` 선택 → "HTML 만들기".

**링크는 사용자에게 받는다.** 기존 실측(claude-code PASS 98.12%)과 비교하려면
아이서퍼 채널톡 eDM 링크가 가장 좋다.

- [ ] **Step 3: 완주까지 대기하고 결과를 기록**

잡 상세 화면과 `data/jobs/<id>/`에서 다음을 수집한다.

```bash
# <id>를 실제 잡 id로 바꾼다
cat data/jobs/<id>/job.json          # status, verify 요약
ls -la data/jobs/<id>/work/output/   # HTML 크기, images/ 개수
```

기록할 항목 (Task 3에서 그대로 쓴다):

| 항목 | 정직한 빌드 기준선 (claude-code, 2026-07-30) |
|---|---|
| 게이트 통과 | PASS, 실패/경고 0 |
| verify % | 98.12% |
| 소요 시간 | 15분 |
| HTML 크기 | 113~122KB |
| images/ 개수 | 12장 (hero/logo/card1~4/…) |
| 라이브 텍스트 | 380자 |

**판정:**
- 게이트 PASS → `CODEX_VERIFICATION = { verification: "verified", note: "YYYY-MM-DD 실측 PASS <n>%, <m>분" }`
- 게이트 FAIL (우회 시도 포함) → `{ verification: "unverified", note: "YYYY-MM-DD 실측 실패 — <게이트 실패 사유>" }`
- 완주 불가(쿼터/타임아웃) → `{ verification: "unverified", note: "YYYY-MM-DD <실패 사유>" }`

**어느 쪽이든 계획은 계속된다.** codex가 실패해도 그 사실을 정직하게 기록하는 것이 이 작업의 목적이다.

- [ ] **Step 4: 측정 결과를 계획 파일에 기록하고 커밋**

이 파일 맨 아래 "측정 결과" 섹션에 표를 채운다.

```bash
git add docs/superpowers/plans/2026-07-31-multi-backend-parity.md
git commit -m "docs: 측정 게이트 A — 현재 게이트에서 codex 재검증 결과"
```

---

### Task 2: 측정 게이트 B — antigravity 완주 가능성 (코드 0줄)

Google AI Pro 쿼터가 15분 파이프라인을 버티는지 **프로바이더를 짜기 전에** 측정한다. 동시에 Task 6의 파서가 쓸 **실측 NDJSON을 캡처**한다.

**Files:**
- 없음 (측정만)
- 산출: `/tmp/agy-stream-sample.ndjson` (커밋하지 않음)

**Interfaces:**
- Consumes: 없음
- Produces: `AGY_VERIFICATION` (Task 7/9), `agy-stream-sample.ndjson` (Task 6의 파서 픽스처 근거)

- [ ] **Step 1: 설치·로그인 확인 및 CLI 표면 기록**

```bash
agy --version
agy --help
```

`--help` 출력에서 다음 셋을 확인해 적어둔다. Task 7/8이 이 값을 쓴다.

1. `--print-timeout`이 받는 duration 형식 (`30m` / `1800` / `1800s` 중 무엇인가)
2. 로그인 상태를 조회하는 하위 명령이 있는가 (`agy login status` 유사)
3. MCP 목록 하위 명령의 정확한 형태 (`agy mcp list` 유사)

- [ ] **Step 2: Figma MCP 연결 확인**

```bash
agy mcp list
```

`figma` 항목이 없으면 등록한다. Antigravity는 `~/.gemini/config/mcp_config.json`을
공유 설정으로 읽는다.

```bash
cat ~/.gemini/config/mcp_config.json
```

**출력 전문을 그대로 보관한다** — Task 8의 파서가 이 텍스트를 상대로 테스트된다.

- [ ] **Step 3: 실제 eDM 프롬프트를 손으로 1회 실행하며 스트림 캡처**

앱이 실제로 쓰는 프롬프트를 그대로 뽑는다. `buildEdmPrompt`는 TS 모듈이므로
레포 루트에서 `tsx`로 실행한다.

```bash
mkdir -p /tmp/agy-probe
cd /Users/example/projects/letterpress
pnpm exec tsx -e "import{buildEdmPrompt}from'./lib/providers/prompt';console.log(buildEdmPrompt({jobId:'probe',figmaUrl:process.argv[1],workDir:'/tmp/agy-probe'}))" '<FIGMA_URL>' > /tmp/agy-prompt.txt
wc -c /tmp/agy-prompt.txt
```

`<FIGMA_URL>`은 Task 1에서 쓴 것과 **같은 링크**로 바꾼다. 출력이 비어 있으면
스킬 경로(`FIGMA_EDM_SKILL_DIR`)를 못 찾은 것이므로 `lib/providers/prompt.ts`를
열어 필요한 env를 확인해 앞에 붙인다.

그다음 실행한다. **Step 1에서 확인한 duration 형식**을 쓴다.

```bash
cd /tmp/agy-probe
time agy -p "$(cat /tmp/agy-prompt.txt)" \
  --output-format stream-json \
  --dangerously-skip-permissions \
  --print-timeout 30m \
  | tee /tmp/agy-stream-sample.ndjson
```

- [ ] **Step 4: 판정 3항목을 기록**

```bash
# 1) 완주 여부 — result 이벤트가 성공으로 끝났는가
tail -3 /tmp/agy-stream-sample.ndjson

# 2) 소요 시간 — 위 `time` 출력

# 3) 산출물 — 게이트를 통과할 모양인가
ls -la /tmp/agy-probe/output/ /tmp/agy-probe/*.png /tmp/agy-probe/verify.json
```

3번은 **쿼터 판정과 별개**다. 완주했다면 Task 9에서 앱을 통해 정식으로 게이트에 태운다.

추가로 **쿼터 잔량**을 확인한다: Antigravity 데스크톱 앱을 열어 평소처럼 쓸 수 있는지 본다 (CLI·앱·SDK가 쿼터를 공유한다).

- [ ] **Step 5: 분기 판정**

- **완주함** → `AGY_VERIFICATION` 후보 확보. Task 3~9 전부 진행한다.
- **쿼터 소진/락으로 중단** → **Task 6·7·8·9를 건너뛴다.** Task 3·4·5만 수행하고,
  Task 5에서 gemini를 지우되 antigravity는 **추가하지 않는다**. 계획 맨 아래
  "측정 결과"에 사유를 남기고 마감한다. 이는 실패가 아니라 스펙 §4가 정의한
  정상 종료다.
- **타임아웃으로 중단** → `--print-timeout` 값을 늘려 1회 재시도. 그래도 안 되면
  위 "쿼터 소진"과 같이 처리한다.

- [ ] **Step 6: 측정 결과를 계획 파일에 기록하고 커밋**

```bash
git add docs/superpowers/plans/2026-07-31-multi-backend-parity.md
git commit -m "docs: 측정 게이트 B — Antigravity(agy) 완주 가능성 실측"
```

---

### Task 3: `AgentProvider`에 검증 축 추가

`ready`(런타임 진단)와 독립된, 측정으로만 올라가는 축을 만든다.

**Files:**
- Modify: `lib/providers/types.ts`
- Modify: `lib/providers/registry.ts:28-30` (`listProviders`)
- Modify: `lib/providers/claude-code.ts` (provider 객체), `codex.ts`, `gemini.ts`, `mock.ts`
- Create: `lib/providers/verification.test.ts`

**Interfaces:**
- Consumes: Task 1의 `CODEX_VERIFICATION`
- Produces: `ProviderVerification` 타입, `AgentProvider.verification` / `.verificationNote`, `ProviderInfo` (registry가 export)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/providers/verification.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listProviders } from "./registry";

describe("프로바이더 검증 상태", () => {
  it("모든 프로바이더가 검증 상태와 근거를 노출한다", () => {
    const all = listProviders();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.verification).toMatch(/^(verified|unverified|sample)$/);
      expect(p.verificationNote.trim().length).toBeGreaterThan(0);
    }
  });

  // "verified"는 측정 기록이 있을 때만 붙인다 — 근거에 측정 날짜를 요구해
  // 규칙을 코드로 강제한다.
  it("verified 프로바이더의 근거에는 측정 날짜가 들어간다", () => {
    for (const p of listProviders()) {
      if (p.verification !== "verified") continue;
      expect(p.verificationNote).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm exec vitest run lib/providers/verification.test.ts
```

기대: FAIL — `p.verification`이 `undefined`이고 `verificationNote`가 없어
`.trim()`에서 터진다.

- [ ] **Step 3: 타입을 추가한다**

Modify `lib/providers/types.ts` — `AgentProvider` 위에 타입을 추가하고 인터페이스에 필드 두 개를 넣는다:

```ts
/**
 * 실전 잡 완주 기록. 코드 완성도가 아니라 측정 결과다.
 * - verified   : 실제 Figma 잡을 끝까지 돌려 게이트 PASS를 확인함
 * - unverified : 코드는 있으나 완주 기록 없음 (선택 시 UI가 경고)
 * - sample     : mock 전용
 */
export type ProviderVerification = "verified" | "unverified" | "sample";
```

`AgentProvider`에 추가:

```ts
export interface AgentProvider {
  id: string;
  label: string;
  /** 측정으로만 올라간다. 실전 PASS 확인 전에는 "verified"로 쓰지 않는다. */
  verification: ProviderVerification;
  /** 근거 한 줄. 예: "2026-07-30 실측 PASS 98.12%, 15분" */
  verificationNote: string;
  run(
    task: AgentTask,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult>;
}
```

- [ ] **Step 4: `listProviders`가 새 필드를 싣게 한다**

Modify `lib/providers/registry.ts` — 파일 끝의 `listProviders`를 교체하고 타입을 export 한다:

```ts
export type ProviderInfo = Pick<
  AgentProvider,
  "id" | "label" | "verification" | "verificationNote"
>;

export function listProviders(): ProviderInfo[] {
  return Object.values(providers).map(({ id, label, verification, verificationNote }) => ({
    id,
    label,
    verification,
    verificationNote,
  }));
}
```

- [ ] **Step 5: 네 프로바이더에 값을 채운다**

`lib/providers/claude-code.ts` — provider 객체의 `label` 바로 아래:

```ts
  verification: "verified",
  verificationNote: "2026-07-30 실측 PASS 98.12%, 15분 (게이트 실패·경고 0)",
```

`lib/providers/codex.ts` — **Task 1의 측정 결과를 그대로 쓴다.** 예시(PASS인 경우):

```ts
  verification: "verified",
  verificationNote: "2026-07-31 실측 PASS 97.4%, 18분",
```

FAIL인 경우:

```ts
  verification: "unverified",
  verificationNote: "2026-07-31 실측 실패 — 게이트: 라이브 텍스트 0자(스크린샷 산출)",
```

`lib/providers/gemini.ts` (Task 5에서 삭제되지만 그전까지 타입을 만족해야 한다):

```ts
  verification: "unverified",
  verificationNote: "실전 완주 기록 없음 — 무료 키 할당량 소진으로 중단",
```

`lib/providers/mock.ts`:

```ts
  verification: "sample",
  verificationNote: "환경 없이 흐름만 보는 샘플 — 실제 Figma를 읽지 않는다",
```

- [ ] **Step 6: 테스트 통과를 확인한다**

```bash
pnpm exec vitest run lib/providers/verification.test.ts
pnpm exec tsc --noEmit
```

기대: 테스트 PASS. `tsc`는 `app/page.tsx` / `SettingsPanel.tsx`의 로컬
`ProviderInfo`가 아직 두 필드를 모르지만, 그쪽은 **구조적으로 좁은 타입**이라
에러가 나지 않는다. 에러가 난다면 Task 4에서 함께 고친다.

- [ ] **Step 7: 커밋**

```bash
git add lib/providers/types.ts lib/providers/registry.ts lib/providers/claude-code.ts lib/providers/codex.ts lib/providers/gemini.ts lib/providers/mock.ts lib/providers/verification.test.ts
git commit -m "feat: 프로바이더에 검증 축(verification) 추가 — 측정으로만 올라간다

ready(런타임 진단)와 독립. 미검증 백엔드를 목록에 그냥 올려두는 것이
팀원에게 함정이었다. verified는 실전 게이트 PASS 확인 후에만 붙이며,
근거에 측정 날짜를 요구하는 테스트로 규칙을 강제한다."
```

---

### Task 4: 검증 상태를 고르기 전에 보여준다

**Files:**
- Modify: `app/page.tsx:47-50` (`ProviderInfo`), `:206-207`, `:408-414` (Select `data`), `:432-447` (경고 Alert)
- Modify: `lib/setup.ts` (`BackendSetup` 인터페이스, `finish()`)
- Modify: `app/components/BackendSetup.tsx:29-34` (`BackendInfo`) + 카드 렌더

**Interfaces:**
- Consumes: Task 3의 `ProviderInfo`, `AgentProvider.verification`
- Produces: `BackendSetup.verification` / `.verificationNote` (진단 API 응답에 포함)

- [ ] **Step 1: `BackendSetup`이 검증 상태를 싣게 한다**

Modify `lib/setup.ts` — `BackendSetup` 인터페이스에 두 필드를 추가한다:

```ts
export interface BackendSetup {
  id: string;
  label: string;
  /** 명시적으로 실패한 단계가 없으면 true (ok=null은 차단하지 않음) */
  ready: boolean;
  /** 실전 완주 기록 — ready와 독립된 축 (registry에서 가져온다). */
  verification: ProviderVerification;
  verificationNote: string;
  steps: SetupStep[];
}
```

`finish()`를 교체한다:

```ts
function finish(id: string, steps: SetupStep[]): BackendSetup {
  const info = listProviders().find((p) => p.id === id);
  return {
    id,
    label: info?.label ?? id,
    ready: steps.every((s) => s.ok !== false),
    verification: info?.verification ?? "unverified",
    verificationNote: info?.verificationNote ?? "",
    steps,
  };
}
```

import에 타입을 더한다:

```ts
import type { ProviderVerification } from "./providers/types";
```

- [ ] **Step 2: 홈 화면 타입을 넓힌다**

Modify `app/page.tsx:47-50`:

```tsx
interface ProviderInfo {
  id: string;
  label: string;
  verification: "verified" | "unverified" | "sample";
  verificationNote: string;
}
```

- [ ] **Step 3: Select 라벨에 표시한다**

Modify `app/page.tsx:408-414` — `data` 콜백을 교체한다:

```tsx
                data={providers.map((p) => {
                  const b = backends?.find((x) => x.id === p.id);
                  // 두 축을 각각 표시한다: 설정이 덜 됐다 / 완주 기록이 없다.
                  const marks = [
                    b && !b.ready ? "설정 필요" : null,
                    p.verification === "unverified" ? "미검증" : null,
                  ].filter(Boolean);
                  return {
                    value: p.id,
                    label: marks.length ? `${p.label} · ${marks.join(" · ")}` : p.label,
                  };
                })}
```

- [ ] **Step 4: 미검증 경고를 추가한다**

Modify `app/page.tsx:206-207` — 파생값을 하나 더 만든다:

```tsx
  const selectedBackend = backends?.find((b) => b.id === provider);
  const notReady = Boolean(selectedBackend && !selectedBackend.ready);
  const selectedProvider = providers.find((p) => p.id === provider);
  const unverified = selectedProvider?.verification === "unverified";
```

Modify `app/page.tsx` — 기존 `{notReady && (<Alert .../>)}` 블록 **바로 뒤**에 추가한다.
두 경고는 원인이 다르므로 합치지 않는다(둘 다 뜰 수 있다). 버튼 문구는 바꾸지 않는다 —
미검증은 "실행하지 말라"가 아니라 "실패할 수 있다"이다.

```tsx
            {unverified && (
              <Alert
                color="yellow"
                variant="light"
                mt="md"
                p="sm"
                data-testid="provider-unverified"
                icon={<IconAlert size={16} />}
              >
                <Text size="xs">
                  이 백엔드는 <b>실제 변환을 끝까지 완주한 기록이 없습니다</b> — 설정이
                  끝나 있어도 중간에 실패할 수 있습니다. 확실한 결과가 필요하면 검증된
                  백엔드를 쓰세요. {selectedProvider?.verificationNote}
                </Text>
              </Alert>
            )}
```

- [ ] **Step 5: 진단 카드에도 근거를 노출한다**

Modify `app/components/BackendSetup.tsx:29-34`:

```tsx
export interface BackendInfo {
  id: string;
  label: string;
  ready: boolean;
  verification: "verified" | "unverified" | "sample";
  verificationNote: string;
  steps: SetupStep[];
}
```

카드에서 백엔드 이름 옆에 배지를 붙인다. `Badge`는 이미 import 되어 있다.
**`Badge.extend`를 쓰지 않는다** (v9에서 런타임에 존재하지 않는다 — AGENTS.md 참조).

```tsx
{b.verification === "verified" ? (
  <Badge size="xs" variant="light" color="green" title={b.verificationNote}>
    검증됨
  </Badge>
) : b.verification === "unverified" ? (
  <Badge size="xs" variant="light" color="yellow" title={b.verificationNote}>
    미검증
  </Badge>
) : null}
```

- [ ] **Step 6: 타입·린트·빌드 확인**

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm exec vitest run
```

기대: 전부 통과. 실패하면 대개 `BackendInfo`를 쓰는 다른 지점이 두 필드를
몰라서다 — 그곳에도 필드를 넣는다.

- [ ] **Step 7: 실제 화면에서 확인**

```bash
pnpm dev
```

`http://localhost:3000`에서 백엔드 Select를 열어 `gemini`가 `· 미검증`으로
보이는지, 선택하면 노란 경고가 뜨는지 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add app/page.tsx app/components/BackendSetup.tsx lib/setup.ts
git commit -m "feat(ui): 백엔드 검증 상태를 고르기 전에 보여준다

'설정 필요'(런타임 진단)와 '미검증'(완주 기록 없음)은 원인도 대응도
다르므로 경고를 합치지 않는다. 미검증은 실행을 막지 않고 버튼 문구도
바꾸지 않는다 — '하지 마라'가 아니라 '실패할 수 있다'이다."
```

---

### Task 5: gemini 백엔드 완전 제거

API 키 방식이라 "구독" 축과 무관하고, 완주 기록이 없으며, `agy`가 `~/.gemini/`
설정을 공유해 진단이 혼선을 빚는다.

**Files:**
- Delete: `lib/providers/gemini.ts`, `lib/providers/gemini.smoke.test.ts`
- Modify: `lib/providers/registry.ts`, `lib/providers/parsers.test.ts:4,84-…`, `lib/providers/prompt.ts:6-11`
- Modify: `lib/settings.ts:18,37,66,83`
- Modify: `lib/setup.ts:13,40-47,174-201,267,359-372`, `lib/setup.test.ts:5,56-77`
- Modify: `app/api/settings/route.ts:6,18,45,80-84`
- Modify: `app/components/SettingsPanel.tsx:31`, `app/components/BackendSetup.tsx` (`GeminiKeyInput` + `SHORT_NAME`)
- Modify: `lib/diagnostics/bundle.ts:26-27`, `lib/diagnostics/bundle.test.ts:13`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 3의 `ProviderInfo`
- Produces: 없음 (제거만)

- [ ] **Step 1: 비밀 마스킹 커버리지가 유지되는지 먼저 확인한다**

`lib/diagnostics/bundle.ts`는 설정에서 뽑은 실제 토큰 값을 문자열 치환하고,
추가로 `figd_`/`sk-`/`AIza` 모양 정규식으로 한 번 더 지운다. `geminiApiKey`를
설정에서 없애면 첫 번째 경로만 사라진다.

**정규식 경로는 이미 독립적으로 테스트돼 있다** — `bundle.test.ts`의
`"등록되지 않은 토큰 형태도 보수적으로 가린다"`가 `scrub(text, [])`로
`AIzaXyzabcdefghij`를 검증한다. 설정과 무관하므로 **새 테스트를 추가할 필요가 없다.**

```bash
pnpm exec vitest run lib/diagnostics/bundle.test.ts
```

기대: PASS (제거 전 기준선). 여기서 실패하면 이 작업과 무관하므로 먼저 고친다.

- [ ] **Step 2: 테스트 픽스처에서 gemini 흔적을 지운다**

Modify `lib/diagnostics/bundle.test.ts` — 세 곳:

(a) `beforeAll`의 설정 픽스처(13줄)에서 `geminiApiKey`를 뺀다:

```ts
    JSON.stringify({ figmaToken: "figd_SUPER_SECRET_TOKEN_1234" }),
```

(b) 첫 테스트의 `expect(raw).not.toContain("AIzaSyFAKEKEY000");` 줄을 지운다
(이제 설정에 그 키가 없다).

(c) `"job.summary(=CLI stderr 꼬리)에 섞인 토큰도 지운다"` 테스트의 `summary`
문자열이 `gemini 실패: …`로 시작한다. 이 테스트가 검증하는 것은 **AIza 형태
스크럽**이지 gemini가 아니므로, 백엔드 이름만 중립적으로 바꾼다:

```ts
      summary:
        "백엔드 실패: GET https://generativelanguage.googleapis.com/v1?key=AIzaSyTESTKEY1234567 401",
```

```bash
pnpm exec vitest run lib/diagnostics/bundle.test.ts
```

기대: PASS.

- [ ] **Step 3: 프로바이더와 레지스트리에서 제거**

```bash
git rm lib/providers/gemini.ts lib/providers/gemini.smoke.test.ts
```

Modify `lib/providers/registry.ts` — import 줄과 맵 항목을 지운다:

```ts
import { getSettings } from "../settings";
import { claudeCodeProvider } from "./claude-code";
import { codexProvider } from "./codex";
import { mockProvider } from "./mock";
import type { AgentProvider } from "./types";

const providers: Record<string, AgentProvider> = {
  [claudeCodeProvider.id]: claudeCodeProvider,
  [codexProvider.id]: codexProvider,
  [mockProvider.id]: mockProvider,
};
```

Modify `lib/providers/parsers.test.ts` — `createGeminiLineMapper` import(4줄)와
`describe("gemini tolerant line mapper", …)` 블록 전체를 지운다.

- [ ] **Step 4: 설정에서 제거**

Modify `lib/settings.ts` — 네 곳을 지운다: `Settings.geminiApiKey`(18),
`Stored.geminiApiKey`(37), `getSettings`의 `geminiApiKey:` 줄(66),
`saveSettings`의 `if (patch.geminiApiKey …)` 줄(83).

기존 `data/settings.json`에 값이 남아 있어도 `Stored`가 모르는 키라 무시되고
다음 저장에서 탈락한다. **마이그레이션 코드는 두지 않는다.**

Modify `lib/providers/prompt.ts:6-11` — `agentEnv`에서 Gemini 분기를 지운다:

```ts
/** Extra env for spawned agent CLIs (Figma REST fallback). */
export function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const { figmaToken } = getSettings();
  if (figmaToken) env.FIGMA_TOKEN = figmaToken;
  // 이하 기존 CHROME_BIN 등 설정은 그대로 둔다
```

> `agentEnv`의 나머지 줄(스킬 경로·`CHROME_BIN`)은 건드리지 않는다. 파일을 열어
> `geminiApiKey` 관련 두 줄만 제거한다.

Modify `lib/diagnostics/bundle.ts:26-27`:

```ts
  const { figmaToken } = getSettings();
  return [figmaToken].filter((s): s is string => Boolean(s) && s.length >= 8);
```

- [ ] **Step 5: 진단(setup)에서 제거**

Modify `lib/setup.ts` — 다섯 곳:
- `GEMINI_BIN` 상수(13)
- `figmaMcpFromGeminiList` 함수 전체(40-47)
- `geminiSetup` 함수 전체(174-201)
- 267줄 `Promise.all([claudeSetup(), geminiSetup(), codexSetup()])` → `Promise.all([claudeSetup(), codexSetup()])`
- `validateGeminiKey` 함수 전체(359-372)

Modify `lib/setup.test.ts` — import(5)에서 `figmaMcpFromGeminiList`를 빼고
`describe("figmaMcpFromGeminiList", …)` 블록(56-77)을 지운다.

- [ ] **Step 6: API·UI에서 제거**

Modify `app/api/settings/route.ts` — 네 곳: import(6)의 `validateGeminiKey`,
응답의 `geminiApiKeySet`(18), zod 스키마의 `geminiApiKey`(45),
검증 블록(80-84).

Modify `app/components/SettingsPanel.tsx:31` — `geminiApiKeySet: boolean;` 삭제.

Modify `app/components/BackendSetup.tsx` — `GeminiKeyInput` 컴포넌트 전체(89-140)와
그 사용처를 지운다. `SHORT_NAME`에서 `gemini` 줄을 지우고 `antigravity`는
Task 7에서 더한다. import에서 더 이상 쓰이지 않는 `PasswordInput`을 지운다
(린트가 잡는다).

- [ ] **Step 7: 전부 통과하는지 확인**

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

기대: 전부 통과. `pnpm build`는 알려진 Turbopack NFT 경고 2건이 나오는데
정상이다 (AGENTS.md 참조).

- [ ] **Step 8: `grep`으로 잔재를 확인**

```bash
grep -rn "gemini\|Gemini\|GEMINI" --include="*.ts" --include="*.tsx" app lib
```

기대: **출력 없음.** Step 2에서 `bundle.test.ts`의 픽스처 문자열까지 바꿨으므로
깨끗해야 한다. 남아 있으면 지운다.

> zsh에서 `--include=*.ts`는 글롭 확장에 걸린다 — 위처럼 따옴표로 감싼다.

- [ ] **Step 9: AGENTS.md 갱신**

`gemini` 서술을 지우고 로스터를 `claude-code` / `codex` / `antigravity` / `mock`로
고친다. Antigravity는 Task 7~9 전까지 "추가 예정"이 아니라 **아직 쓰지 않는다** —
Task 9에서 실측 결과와 함께 쓴다. 이 단계에서는 gemini 제거 사실과 그 이유만 적는다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "refactor: gemini 백엔드 제거 — 구독 축과 무관하고 완주 기록이 없다

API 키 방식이라 '구독이 있으면 누구든'이라는 목표와 맞지 않고, 실전 완주
기록이 0건이라 목록에 남아 있는 것 자체가 팀원에게 함정이었다. agy가
~/.gemini/ 설정을 공유해 진단이 혼선을 빚는 문제도 함께 사라진다.

설정 마이그레이션은 두지 않는다 — 남은 geminiApiKey는 모르는 키라 무시되고
다음 저장에서 탈락한다. bundle.ts의 AIza 정규식 마스킹은 테스트로 남겼다."
```

---

> **분기점:** Task 2 Step 5에서 "쿼터 소진/락"으로 판정됐다면 여기서 멈춘다.
> Task 9의 문서화 단계만 수행하고 계획을 마감한다.

---

### Task 6: `agy` 스트림 파서 (TDD)

**Files:**
- Create: `lib/providers/antigravity.ts` (파서 부분만)
- Modify: `lib/providers/parsers.test.ts`
- 참조: `/tmp/agy-stream-sample.ndjson` (Task 2 캡처)

**Interfaces:**
- Consumes: Task 2의 실측 NDJSON
- Produces: `AgyLine` 타입, `createAgyLineMapper(onEvent) → { handle(line), finish() }`

- [ ] **Step 1: 실측 라인 모양을 먼저 확인한다**

```bash
head -3 /tmp/agy-stream-sample.ndjson
grep -o '"type":"[^"]*"' /tmp/agy-stream-sample.ndjson | sort | uniq -c
grep -o '"step_type":"[^"]*"' /tmp/agy-stream-sample.ndjson | sort | uniq -c
```

**아래 Step 2의 픽스처는 공식 문서 스키마 기준이다. 실측과 다르면 실측값으로
바꾼다** — 이 프로젝트는 추측 스키마를 커밋하지 않는다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

Modify `lib/providers/parsers.test.ts` — import에 추가하고 describe를 더한다:

```ts
import { createAgyLineMapper } from "./antigravity";
```

```ts
describe("antigravity(agy) stream-json mapper", () => {
  const collect = () => {
    const events: AgentEvent[] = [];
    return { events, mapper: createAgyLineMapper((e) => events.push(e)) };
  };

  it("init을 세션 시작 상태로 바꾼다", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "init", conversation_id: "c1", init: { model: "gemini-3.6-flash" } });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status");
    expect(events[0].text).toContain("gemini-3.6-flash");
  });

  it("text_delta를 완성된 줄 단위로만 흘린다", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "step_update", state: "ACTIVE", text_delta: "첫 줄\n둘째 " });
    expect(events.map((e) => e.text)).toEqual(["첫 줄"]);
    mapper.handle({ type: "step_update", state: "ACTIVE", text_delta: "줄\n" });
    expect(events.map((e) => e.text)).toEqual(["첫 줄", "둘째 줄"]);
  });

  it("툴은 완료 시점에만 한 줄 남긴다 (ACTIVE는 무시)", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "step_update", state: "ACTIVE", tool_name: "figma.get_design_context" });
    expect(events).toHaveLength(0);
    mapper.handle({ type: "step_update", state: "DONE", tool_name: "figma.get_design_context" });
    expect(events).toEqual([
      expect.objectContaining({ type: "tool", text: "figma.get_design_context" }),
    ]);
  });

  it("result 성공에서 최종 응답을 얻는다", () => {
    const { mapper } = collect();
    mapper.handle({ type: "result", status: "success", response: "eDM 빌드 완료" });
    expect(mapper.finish()).toEqual({ finalResponse: "eDM 빌드 완료", errorText: "" });
  });

  it("result 실패를 에러 이벤트와 errorText로 남긴다", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "result", status: "error", error: { message: "quota exhausted" } });
    expect(events).toEqual([expect.objectContaining({ type: "error", text: "quota exhausted" })]);
    expect(mapper.finish().errorText).toBe("quota exhausted");
  });

  it("버퍼에 남은 마지막 줄을 finish에서 흘린다", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "step_update", state: "ACTIVE", text_delta: "개행 없는 마지막 줄" });
    expect(events).toHaveLength(0);
    mapper.finish();
    expect(events.map((e) => e.text)).toEqual(["개행 없는 마지막 줄"]);
  });

  it("모르는 타입은 조용히 무시한다", () => {
    const { events, mapper } = collect();
    mapper.handle({ type: "telemetry_whatever" });
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm exec vitest run lib/providers/parsers.test.ts
```

기대: FAIL — `./antigravity` 모듈이 없다.

- [ ] **Step 4: 파서를 구현한다**

Create `lib/providers/antigravity.ts`:

```ts
import type { AgentEvent } from "./types";

// agy --output-format stream-json (v1.1.8+) 실측 스키마.
// 공식 headless 문서 기준 3종: init / step_update / result.
// 관측되지 않은 필드는 optional로 두고, 모르는 type은 무시한다.
export interface AgyLine {
  type?: string;
  conversation_id?: string;
  init?: { cwd?: string; model?: string; agent?: string };
  step_index?: number;
  state?: "ACTIVE" | "DONE" | string;
  step_type?: string;
  tool_name?: string;
  text_delta?: string;
  status?: string;
  response?: string;
  error?: { message?: string } | string;
}

const errText = (e: AgyLine["error"], fallback: string): string =>
  typeof e === "string" ? e : (e?.message ?? fallback);

/**
 * Stateful mapper: text_delta 청크를 완성된 줄로 모아 흘리고, 최종 응답과
 * 첫 에러를 붙잡는다. 순수 로직이라 유닛 테스트로 덮는다.
 */
export function createAgyLineMapper(onEvent: (e: AgentEvent) => void) {
  let buffer = "";
  let finalResponse = "";
  let errorText = "";

  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    if (text) onEvent({ ts: Date.now(), type: "log", text });
  };

  return {
    handle(line: AgyLine) {
      switch (line.type) {
        case "init": {
          const model = line.init?.model;
          onEvent({
            ts: Date.now(),
            type: "status",
            text: model ? `Antigravity 세션 시작 (${model})` : "Antigravity 세션 시작",
          });
          return;
        }
        case "step_update": {
          if (typeof line.text_delta === "string") {
            buffer += line.text_delta;
            const parts = buffer.split("\n");
            buffer = parts.pop() ?? "";
            for (const p of parts) {
              if (p.trim()) onEvent({ ts: Date.now(), type: "log", text: p.trim() });
            }
            return;
          }
          // 툴은 완료 시점에만 남긴다 — ACTIVE까지 찍으면 로그가 두 배가 된다.
          if (line.tool_name && line.state === "DONE") {
            flush();
            onEvent({ ts: Date.now(), type: "tool", text: line.tool_name });
          }
          return;
        }
        case "result": {
          flush();
          const failed = Boolean(line.error) || (line.status !== undefined && line.status !== "success");
          if (failed) {
            errorText = errText(line.error, line.status ?? "unknown error");
            onEvent({ ts: Date.now(), type: "error", text: errorText });
          } else {
            finalResponse = line.response ?? finalResponse;
          }
          return;
        }
        default:
          return;
      }
    },
    finish() {
      flush();
      return { finalResponse, errorText };
    },
  };
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

```bash
pnpm exec vitest run lib/providers/parsers.test.ts
```

기대: PASS.

- [ ] **Step 6: 실측 파일 전체를 흘려 크래시가 없는지 확인한다**

```bash
pnpm exec tsx -e "
import {readFileSync} from 'node:fs';
import {createAgyLineMapper} from './lib/providers/antigravity';
const ev:any[]=[]; const m=createAgyLineMapper(e=>ev.push(e));
let bad=0;
for (const l of readFileSync('/tmp/agy-stream-sample.ndjson','utf8').split('\n')) {
  if(!l.trim())continue;
  try{ m.handle(JSON.parse(l)); }catch{ bad++; }
}
console.log('events',ev.length,'unparsed',bad,'finish',m.finish());
"
```

기대: `events`가 0보다 크고, `finish().finalResponse`가 비어 있지 않다.
0이면 실측 스키마가 문서와 다른 것이므로 Step 2 픽스처와 Step 4 구현을 실측에 맞춘다.

- [ ] **Step 7: 커밋**

```bash
git add lib/providers/antigravity.ts lib/providers/parsers.test.ts
git commit -m "feat: agy stream-json 라인 파서 (실측 스키마 기준)

init/step_update/result 3종이 타입 지정돼 있어 gemini의 관용 매칭보다
깨끗하다. 툴은 DONE에서만 한 줄 남기고, text_delta는 완성된 줄 단위로만
흘린다."
```

---

### Task 7: antigravity 프로바이더 결선

**Files:**
- Modify: `lib/providers/antigravity.ts` (provider 객체 추가)
- Modify: `lib/providers/registry.ts`
- Create: `lib/providers/antigravity.smoke.test.ts`
- Modify: `app/components/BackendSetup.tsx` (`SHORT_NAME`)

**Interfaces:**
- Consumes: Task 6의 `createAgyLineMapper`, Task 3의 `verification` 필드, `runJsonlCli`/`exitReason`(`jsonl-cli.ts`), `agentEnv`/`buildEdmPrompt`(`prompt.ts`), `getSettings()`(`../settings`)
- Produces: `antigravityProvider: AgentProvider` (id `"antigravity"`)

- [ ] **Step 1: provider 객체를 추가한다**

Modify `lib/providers/antigravity.ts` — 파일 위쪽 import를 넓히고:

```ts
import { getSettings } from "../settings";
import { exitReason, runJsonlCli } from "./jsonl-cli";
import { agentEnv, buildEdmPrompt } from "./prompt";
import type { AgentEvent, AgentProvider, AgentResult } from "./types";
```

파일 끝에 추가한다:

```ts
const AGY_BIN = process.env.ANTIGRAVITY_BIN ?? "agy";

/**
 * agy의 print 모드 기본 타임아웃은 5분이다 — 이 앱의 eDM 파이프라인은 실측
 * 15분이라 반드시 늘려야 한다. 잡 타임아웃과 같은 값을 쓴다.
 */
function printTimeoutArg(): string {
  return `${getSettings().jobTimeoutMinutes}m`;
}

export const antigravityProvider: AgentProvider = {
  id: "antigravity",
  label: "Antigravity CLI (Google 구독)",
  verification: "unverified",
  verificationNote: "실전 검증 진행 중 — Task 9에서 확정",

  async run(task, onEvent, signal): Promise<AgentResult> {
    const prompt = task.promptOverride ?? buildEdmPrompt(task);
    const mapper = createAgyLineMapper(onEvent);

    const result = await runJsonlCli({
      bin: AGY_BIN,
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        // 잡 작업 디렉터리는 우리가 만든 것이고 앱은 로컬 전용이다.
        "--dangerously-skip-permissions",
        "--print-timeout",
        printTimeoutArg(),
      ],
      cwd: task.workDir,
      env: agentEnv(),
      signal,
      onJson: (obj) => mapper.handle(obj as AgyLine),
      onText: (raw) => onEvent({ ts: Date.now(), type: "log", text: raw }),
    });

    const { finalResponse, errorText } = mapper.finish();

    if (result.kind === "aborted") return { ok: false, summary: "사용자가 취소했습니다." };
    if (result.kind === "spawn-error") {
      const message = result.error?.message ?? "unknown";
      onEvent({ ts: Date.now(), type: "error", text: `agy 실행 실패: ${message}` });
      return {
        ok: false,
        summary: `Antigravity CLI를 실행할 수 없습니다: ${message} (설치 후 \`agy\`를 한 번 실행해 로그인하세요)`,
      };
    }

    const fatal = finalResponse.trim().startsWith("FATAL:");
    const ok = result.code === 0 && !fatal && !errorText;
    return {
      ok,
      summary: ok
        ? finalResponse || "완료"
        : errorText || finalResponse || result.stderrTail || exitReason(result),
    };
  },
};
```

> **로그인 사전 확인은 넣지 않는다.** codex가 그것을 하는 이유는 "미인증 상태에서
> `codex exec`가 조용히 멈춘다"는 관측 때문이다. `agy`에 같은 문제가 있는지는
> Task 8 Step 1에서 확인하고, 있을 때만 추가한다. 없는 문제에 코드를 쓰지 않는다.

- [ ] **Step 2: 레지스트리에 등록한다**

Modify `lib/providers/registry.ts`:

```ts
import { antigravityProvider } from "./antigravity";
```

```ts
const providers: Record<string, AgentProvider> = {
  [claudeCodeProvider.id]: claudeCodeProvider,
  [codexProvider.id]: codexProvider,
  [antigravityProvider.id]: antigravityProvider,
  [mockProvider.id]: mockProvider,
};
```

Modify `app/components/BackendSetup.tsx` — `SHORT_NAME`:

```tsx
const SHORT_NAME: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
};
```

- [ ] **Step 3: 스모크 테스트를 추가한다**

Create `lib/providers/antigravity.smoke.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { antigravityProvider } from "./antigravity";
import type { AgentEvent } from "./types";

// Spawns the real `agy` CLI (uses the Google subscription — burns quota).
// Opt-in only: RUN_ANTIGRAVITY_SMOKE=1 pnpm exec vitest run lib/providers/antigravity.smoke.test.ts
describe.skipIf(!process.env.RUN_ANTIGRAVITY_SMOKE)("antigravity provider smoke", () => {
  it("spawns agy, streams events, and sees files it writes", { timeout: 180_000 }, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "mhm-agy-smoke-"));
    const events: AgentEvent[] = [];

    const result = await antigravityProvider.run(
      {
        jobId: "smoke",
        figmaUrl: "https://www.figma.com/design/x/y",
        workDir,
        promptOverride:
          'Create a file at ./output/smoke.txt containing exactly the text "hello from agy". Then reply with one short sentence confirming it.',
      },
      (e) => events.push(e),
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    const content = await readFile(path.join(workDir, "output", "smoke.txt"), "utf8");
    expect(content.trim()).toBe("hello from agy");
  });
});
```

- [ ] **Step 4: 스모크 테스트를 실제로 돌린다**

```bash
RUN_ANTIGRAVITY_SMOKE=1 pnpm exec vitest run lib/providers/antigravity.smoke.test.ts
```

기대: PASS. 여기서 `--print-timeout` 형식 오류나 인자 이름 오류가 잡힌다.
실패하면 Task 2 Step 1에 적어둔 `agy --help` 내용과 대조해 인자를 고친다.

- [ ] **Step 5: 회귀 확인**

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
```

- [ ] **Step 6: 커밋**

```bash
git add lib/providers/antigravity.ts lib/providers/registry.ts lib/providers/antigravity.smoke.test.ts app/components/BackendSetup.tsx
git commit -m "feat: Antigravity CLI(agy) 백엔드 추가

--print-timeout을 잡 타임아웃과 같은 값으로 넘긴다 — 기본 5분이라
15분 파이프라인이 무조건 잘린다. verification은 unverified로 시작하며
실전 PASS 확인 후에만 올린다.

로그인 사전 확인은 넣지 않았다 — codex가 그것을 하는 이유(미인증 시
조용히 멈춤)가 agy에도 있는지 확인되지 않았다."
```

---

### Task 8: antigravity 진단(setup) 추가

**Files:**
- Modify: `lib/setup.ts` (`AGY_BIN`, `figmaMcpFromAgyList`, `antigravitySetup`, `getBackendSetup`)
- Modify: `lib/setup.test.ts`

**Interfaces:**
- Consumes: Task 2 Step 2의 실측 `agy mcp list` 출력, Task 7의 `antigravityProvider`
- Produces: `figmaMcpFromAgyList(out: string): McpStatus`, `antigravitySetup(): Promise<BackendSetup>`

- [ ] **Step 1: 로그인 조회 명령과 미인증 동작을 확인한다**

```bash
agy --help | grep -i -A2 "login\|auth"
```

로그인 상태 조회 하위 명령이 **있으면** Step 4의 `login` 단계에 쓴다.
**없으면** 그 단계를 만들지 않는다 (CLI 설치 + Figma 접근 두 단계만 둔다).

- [ ] **Step 2: 실패하는 파서 테스트를 쓴다**

Modify `lib/setup.test.ts` — import에 `figmaMcpFromAgyList`를 더하고 describe를 추가한다.
**아래 문자열은 Task 2 Step 2에서 보관한 실측 출력으로 교체한다.**

```ts
describe("figmaMcpFromAgyList", () => {
  it("연결된 figma 항목을 connected로 읽는다", () => {
    expect(
      figmaMcpFromAgyList("✓ figma: https://mcp.figma.com/mcp (http) - Connected"),
    ).toBe("connected");
  });

  it("끊긴 항목을 registered로 읽는다", () => {
    expect(
      figmaMcpFromAgyList("✗ figma: https://mcp.figma.com/mcp (http) - Disconnected"),
    ).toBe("registered");
  });

  it("figma 항목이 없으면 missing", () => {
    expect(figmaMcpFromAgyList("Configured MCP servers:\n(none)")).toBe("missing");
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm exec vitest run lib/setup.test.ts
```

기대: FAIL — `figmaMcpFromAgyList`가 없다.

- [ ] **Step 4: 파서와 진단을 구현한다**

Modify `lib/setup.ts` — 상수와 파서를 추가한다:

```ts
const AGY_BIN = () => process.env.ANTIGRAVITY_BIN ?? "agy";
```

```ts
/** `agy mcp list`: "✓ figma: https://mcp.figma.com/mcp (http) - Connected" */
export function figmaMcpFromAgyList(out: string): McpStatus {
  const line = findFigmaLine(out);
  if (!line) return "missing";
  if (/[✔✓]/.test(line)) return "connected";
  // 심볼 없는 포맷 대비: "Disconnected"를 지운 뒤 "Connected"가 남는지 본다.
  return /\bconnected\b/i.test(line.replace(/disconnected/gi, "")) ? "connected" : "registered";
}
```

진단 함수를 추가한다 (`codexSetup` 아래):

```ts
async function antigravitySetup(): Promise<BackendSetup> {
  const cli = await cliVersion(AGY_BIN());
  const list = cli.ok ? await mcpList(AGY_BIN(), 20_000) : null;
  const mcp = list === null ? null : figmaMcpFromAgyList(list);

  const steps: SetupStep[] = [
    {
      name: "CLI 설치",
      ok: cli.ok,
      detail: cli.ok ? cli.detail : "미설치",
      hint: cli.ok
        ? undefined
        : "antigravity.google.com/download 에서 설치한 뒤 `agy`를 한 번 실행해 구글 계정으로 로그인하세요.",
    },
    figmaAccessStep(
      mcp,
      "agy mcp add figma https://mcp.figma.com/mcp",
      "터미널에서 `agy` 실행 후 /mcp 로 figma 재인증 — 또는 설정에 Figma 토큰을 입력하면 REST 폴백으로 동작합니다.",
    ),
  ];
  return finish("antigravity", steps);
}
```

> `agy mcp add`의 정확한 형태는 Step 1의 `--help`로 확인해 위 문자열을 고친다.
> Step 1에서 로그인 조회 명령을 찾았다면 `codexSetup`의 `login` 단계를 본떠
> 두 단계 사이에 넣는다.

`getBackendSetup`의 `Promise.all`에 더한다:

```ts
      ...(await Promise.all([claudeSetup(), codexSetup(), antigravitySetup()])),
```

- [ ] **Step 5: 테스트 통과를 확인한다**

```bash
pnpm exec vitest run lib/setup.test.ts
```

- [ ] **Step 6: 실제 화면에서 확인한다**

```bash
pnpm dev
```

홈의 🔌 백엔드 연동 패널에 Antigravity 카드가 뜨고, 설치/Figma 접근 상태가
실제와 맞는지 본다. "연동 테스트" 버튼도 눌러 본다 (실제 CLI를 스폰한다).

- [ ] **Step 7: 커밋**

```bash
git add lib/setup.ts lib/setup.test.ts
git commit -m "feat: Antigravity 백엔드 연동 진단 — 설치·Figma MCP

mcp list 파서는 실측 출력 기준. 팀원이 자기 환경에서 뭘 더 해야 하는지
카드에서 바로 보고 명령을 복사할 수 있어야 한다."
```

---

### Task 9: 실전 검증과 문서 확정

**Files:**
- Modify: `lib/providers/antigravity.ts` (`verification` / `verificationNote` 확정)
- Modify: `lib/providers/codex.ts` (Task 1 결과가 잠정이었다면 확정)
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-07-31-multi-backend-parity.md` (측정 결과)
- Modify: 메모리 `letterpress-backend-parity-goal.md` (결론 반영)

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: 확정된 `verification` 값

- [ ] **Step 1: 앱에서 antigravity로 실제 잡 1건을 돌린다**

```bash
pnpm dev
```

Task 1과 **같은 Figma 링크**를 쓴다 — 백엔드 비교가 목적이다.

- [ ] **Step 2: 결과를 수집한다**

```bash
cat data/jobs/<id>/job.json
ls -la data/jobs/<id>/work/output/
```

Task 1 Step 3의 기준선 표와 같은 항목을 채운다.

- [ ] **Step 3: `verification`을 확정한다**

Modify `lib/providers/antigravity.ts`:

```ts
  verification: "verified",
  verificationNote: "2026-07-31 실측 PASS 97.8%, 21분",
```

또는 실패했다면:

```ts
  verification: "unverified",
  verificationNote: "2026-07-31 실측 실패 — Google AI Pro 쿼터 소진으로 중단(12분)",
```

- [ ] **Step 4: 아카이브 회귀로 게이트가 안 변했음을 확인한다**

로스터 변경이 게이트 판정에 영향을 주지 않아야 한다.

`checkAcceptance(jobId, opts)` 시그니처를 그대로 쓴다 (`lib/jobs/acceptance.ts:133`).
`freshSince`를 넘기지 않으므로 아카이브된 증거가 그대로 인정된다 — 이 회귀의 목적은
게이트 판정 자체가 변했는지 보는 것이다.

```bash
pnpm exec tsx -e "
import {checkAcceptance} from './lib/jobs/acceptance';
import {readdirSync} from 'node:fs';
for (const id of readdirSync('data/jobs')) {
  const r = await checkAcceptance(id);
  console.log(id, r.ok ? 'PASS' : 'FAIL', r.failures.join(' | '));
}
"
```

기대 (2026-07-30 실측과 동일):
- `claude-code` 잡 2건 (`098b0847`, `652e66ca` 등) → PASS
- `codex` 잡 3건 (`492f5aa4`, `00ae9d9a`, `ec4b0db9`) → FAIL (라이브 텍스트 0자,
  스크린샷 규칙, 커버리지 100%)

실제 브라우저를 띄우므로 잡당 수 초 걸린다. 판정이 하나라도 달라지면
로스터 변경이 게이트를 건드린 것이므로 원인을 찾기 전에는 커밋하지 않는다.

- [ ] **Step 5: AGENTS.md를 갱신한다**

"Agent backends" 항목의 실전 상태 문단을 고친다. 형식은 기존 claude-code 서술과
같게 — 날짜, PASS %, 소요 시간, 게이트 실패 수, 라이브 텍스트 수, 이미지 수.

`verification` 축의 존재와 규칙("실전 PASS 전에는 verified로 쓰지 않는다")을
Architecture map에 한 줄 추가한다.

- [ ] **Step 6: 측정 결과 섹션을 채우고 메모리를 갱신한다**

이 파일 아래 "측정 결과" 표를 완성한다. 그리고 메모리
`letterpress-backend-parity-goal.md`의 마지막 문단에 결론(어느 백엔드가
verified가 됐는지)을 한 줄 반영한다.

- [ ] **Step 7: 전체 검증**

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 백엔드 실전 검증 확정 — verification 값 고정

같은 Figma 링크로 codex/antigravity를 각 1회 완주시켜 게이트 판정을
측정했다. 아카이브 8건 회귀로 로스터 변경이 게이트에 영향을 주지
않음도 확인했다."
```

---

## 측정 결과

> Task 1 · 2 · 9에서 채운다. 빈 칸으로 두지 않는다.

| 백엔드 | 측정일 | 완주 | 게이트 | verify % | 소요 | HTML | images | 라이브 텍스트 | verification |
|---|---|---|---|---|---|---|---|---|---|
| claude-code | 2026-07-30 | ✅ | PASS | 98.12% | 15분 | 113~122KB | 12 | 380자 | verified |
| codex | | | | | | | | | |
| antigravity | | | | | | | | | |

**Antigravity 쿼터 관찰 (Task 2):**

- 완주 여부:
- 소요 시간:
- 실행 후 데스크톱 앱 사용 가능 여부:
- `--print-timeout` 형식:
