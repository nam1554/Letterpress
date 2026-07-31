# Letterpress (레터프레스)

> 사내 저장소명: `marketing-html-maker`

Figma eDM 디자인 링크를 붙여넣으면 **AI 에이전트가 헤드리스로 이메일 HTML을
생성**하고, 브라우저에서 결과물(HTML + images/)을 zip으로 다운로드하는 **로컬
전용** 도구입니다. 서비스 배포용이 아닙니다. 백엔드는 Claude Code(기본) ·
Codex CLI · Antigravity CLI · Mock 중 선택할 수 있습니다 — 팀원이 어떤 구독
(Claude · ChatGPT/Codex · Google/Antigravity)을 갖고 있든 골라서 쓰면 됩니다.

생성 파이프라인은 이 저장소에 포함된 `figma-edm` 스킬(`skills/figma-edm`,
픽셀 검증 포함)을 그대로 사용하며, 산출물은 실무 발송 패키지 형태(700px 테이블 레이아웃, `images/`
상대경로, 반응형 변형, base64 자립형 프리뷰)입니다.

## 빠른 시작 (3줄 요약)

1. Finder에서 **`시작하기.command` 더블클릭** → 브라우저가 자동으로 열립니다
2. 화면 상단 **환경 점검**과 **🔌 백엔드 연동** 패널이 빨간/노란 항목을
   안내하면 그대로 해결 (해결 명령 복사 버튼 제공)
3. Figma 디자인 링크를 붙여넣고 **HTML 만들기** → 10~20분 후 zip 다운로드

## 팀원 온보딩 (처음 받은 사람용)

이 도구는 각자의 머신에서 **각자가 이미 갖고 있는 구독**으로 실행됩니다.
Claude · ChatGPT(Codex) · Google(Antigravity) 중 **하나만 있으면 됩니다** —
셋 다 실제 잡을 끝까지 돌려 같은 품질 게이트를 통과한 기록이 있습니다.

**직접 하셔야 하는 것은 두 가지뿐입니다:**

1. **본인 구독의 CLI 설치 + 로그인** — 하나만 고르세요. 변환 1회당 본인
   구독의 토큰을 사용합니다.
2. **Figma 접근 연결** — **고른 백엔드에 따라 방법이 다릅니다.**

| 갖고 있는 구독 | ① 설치 + 로그인 | ② Figma 접근 |
|---|---|---|
| Claude | `claude`를 한 번 실행해 로그인 | claude.ai **Figma 커넥터** 연결 (`claude` 대화에서 Figma 링크가 읽히면 정상) |
| ChatGPT | `npm i -g @openai/codex` → `codex login` | `codex mcp add figma --url https://mcp.figma.com/mcp` (등록 시 브라우저 OAuth) |
| Google | [antigravity.google.com/download](https://antigravity.google.com/download) 설치 → `agy` 한 번 실행해 구글 로그인 | **Figma 개인 토큰 필수** — 이 백엔드만 MCP 경로가 없습니다. figma.com → Settings → Security → Personal access tokens에서 발급해 앱 **⚙️ 설정**의 "Figma 토큰" 칸에 저장 |

> 어느 쪽이든 **🔌 백엔드 연동 패널**이 위 두 단계를 백엔드별로 점검하고,
> 막힌 단계에 해결 명령을 복사 버튼과 함께 띄웁니다. 표를 외울 필요 없이
> 앱이 시키는 대로 따라가면 됩니다.

**나머지는 런처가 처리합니다** (macOS는 `시작하기.command`, Windows는
`시작하기.bat`을 더블클릭):

- Node.js가 없거나 버전이 낮으면 → 설치 방법을 화면에 안내하고 다운로드
  페이지를 열어 줍니다 (Homebrew가 있으면 물어본 뒤 바로 설치)
- pnpm(패키지 관리자) → 없으면 자동 설치
- 앱 의존성 설치·빌드 → 첫 실행과 코드 변경 시 자동
- 포트가 사용 중이면 → 빈 포트를 찾아 자동으로 그쪽에서 실행
- Google Chrome / 파이썬 패키지(픽셀 검증용) → 빠졌으면 알려주고, 파이썬
  패키지는 물어본 뒤 설치까지 해 줍니다

> `figma-edm` 스킬은 이 저장소 안에 포함돼 있습니다(`skills/figma-edm`).
> 예전처럼 `~/.claude/skills/`에 따로 두거나 심링크를 만들 필요가 없습니다.

### Windows에서

`시작하기.bat`을 더블클릭하면 됩니다 (실제 동작은 `scripts/start-windows.ps1`).
macOS 런처와 같은 일을 하되 윈도우 방식으로 처리합니다 — Node는 `winget`으로
설치 제안, 파이썬은 `py -3`(윈도우에는 `python3` 명령이 없습니다), Chrome은
`Program Files`/`LOCALAPPDATA`에서 탐색합니다.

- **Claude Code CLI**: `winget install Anthropic.ClaudeCode` (관리자 권한 불필요)
- **파이썬**: 설치 화면에서 **"Add python.exe to PATH"를 반드시 체크**하세요 —
  체크하지 않으면 픽셀 검증이 실행되지 않습니다
- WSL은 필요 없습니다. 네이티브로 동작합니다.

> 압축파일(zip)로 받았다면 Windows가 `시작하기.bat`을 차단할 수 있습니다 —
> 파일 **우클릭 → 속성 → 아래쪽 "차단 해제" 체크 → 확인** 후 실행하세요.

> 윈도우 실기기 검증은 아직입니다. 런처는 PowerShell 파서·정적 분석기
> (PSScriptAnalyzer)로 검사했고, 윈도우 전용 명령을 스텁으로 바꿔 전 분기를
> 실행해 봤습니다(정상 시작 / 포트 충돌 / 이미 실행 중 / Node 없음). 그래도
> 막히는 지점이 있으면 화면 메시지와 `시작-기록.log`를 함께 알려주세요.

홈 화면 상단의 **환경 점검 배너**가 위 항목들을 다시 한 번 진단해 주고,
**🔌 백엔드 연동 패널**이 백엔드별로 설치 → 인증 → Figma 접근을 단계별로
점검해 줍니다.
막힌 단계에는 해결 명령이 복사 버튼과 함께 표시되고, **"연동 테스트"** 버튼으로
실제 CLI를 초소형 프롬프트로 실행해 몇 초 만에 "진짜 동작함"을 확인할 수
있습니다 (10분짜리 실제 변환을 돌려볼 필요 없음).

## 실행

**터미널이 낯설다면**: Finder에서 프로젝트 폴더의 **`시작하기.command`를
더블클릭**하세요. 의존성 설치(첫 실행)와 빌드, 서버 시작, 브라우저 열기까지
자동으로 진행되고, 뜨는 창을 닫으면 앱이 종료됩니다. `git pull`로 코드가
바뀌면 다음 실행 때 알아서 다시 빌드합니다.

> 압축파일(zip)로 전달받은 경우 macOS 보안 경고가 뜰 수 있습니다 — 첫 1회만
> 파일을 **우클릭 → 열기**로 실행하면 이후엔 더블클릭이 됩니다.

개발자용 (터미널):

```bash
pnpm install
pnpm dev        # http://localhost:3000 (PORT=25252 pnpm dev 로 앱 기본 포트 사용)
```

> 런처가 쓰는 기본 포트는 **25252**입니다 — IANA 미할당이고, 리눅스 임시 포트
> 범위(32768+) 밖이며, 흔한 개발 포트(3000·5173·8080)나 Steam·Mongo 대역과
> 겹치지 않는 값으로 골랐습니다. `PORT` 환경변수로 바꿀 수 있습니다.

상시 켜두고 쓰려면 프로덕션 모드가 더 안정적입니다 (HMR 재시작으로 실행 중
잡이 끊기는 일 없음):

```bash
pnpm build && pnpm start
```

1. 홈에서 Figma 디자인 URL 입력 (`figma.com/design/...?node-id=...`)
2. 프로바이더 선택 후 "HTML 만들기"
   - **Claude Code (local CLI)** — 기본. `claude` CLI 로그인 + claude.ai Figma
     커넥터 연결 필요. (헤드리스에서 Figma MCP가 빠지면 로그에 FATAL 표시)
   - **Codex CLI (ChatGPT 구독)** — `npm i -g @openai/codex`, `codex login`.
     Figma 접근은 `codex mcp add figma --url https://mcp.figma.com/mcp` (등록 시
     브라우저 OAuth).
   - **Antigravity CLI (Google 구독)** — [antigravity.google.com/download](https://antigravity.google.com/download)에서
     설치한 뒤, 터미널에서 `agy`를 한 번 실행해 구글 계정으로 로그인하세요.
     **Figma 개인 액세스 토큰이 필수입니다** — 이 백엔드는 다른 두 백엔드와
     달리 **Figma MCP 연결 경로가 없어서** 토큰이 Figma에 접근하는 유일한
     방법입니다. figma.com → Settings → Security → Personal access tokens에서
     발급해 앱의 **⚙️ 설정** 패널의 "Figma 토큰" 칸에 저장하세요.
   - **Mock** — 토큰 소모 없이 UI/다운로드 플로우 확인용 샘플 산출물

   세 백엔드 모두 **실제 Figma 잡을 끝까지 돌려 품질 게이트를 통과한 실측
   기록**이 있습니다 (2026-07-31 기준): Claude Code PASS 98.12%·15분,
   Codex PASS 93.51%·3.3분, Antigravity PASS 93.5%·3.7분. 구독만 있으면
   어느 쪽을 골라도 같은 합격선의 결과물을 받습니다.
3. 작업 페이지에서 실시간 로그(SSE) 확인 → 완료 후 미리보기 / 개별 다운로드 /
   전체 zip. 실행 중 취소, 완료 후 다시 실행·삭제 가능
4. **발송 준비** (완료된 작업에서):
   - **CDN 교체본** — images/를 CDN에 올린 뒤 URL 템플릿
     (`{folder}`/`{file}`/`{name}`/`{ext}`)을 입력하면 src를 일괄 치환한 발송용
     HTML을 `hosted/`에 생성. 템플릿은 설정에 저장돼 재사용하고,
     **캠페인 폴더명(`{folder}`)** 은 생성할 때마다 입력합니다 — 기본값은
     `제목슬러그_오늘날짜`(예: `aisurfer_edm_20260729`)이고, 캠페인마다 폴더를
     나눠야 지난 발송본 이미지를 덮어쓰지 않습니다
     (예: IIIF `https://…/iiif/3/{folder}__{file}/full/max/0/default.{ext}`)
   - **발송 전 검사** — HTML 산출물별 "검사" 버튼: Gmail 102KB 클리핑,
     `<script>`, 이미지 alt, 배경 이미지(Outlook), http 링크, 프리헤더,
     상대경로 이미지 잔존 여부를 점검
   - **픽셀 검증 리포트** — Figma↔렌더 나란히 비교와 차이 히트맵을 잡
     페이지에서 바로 확인 (PASS의 시각적 근거)

## 설정

**홈 화면의 "⚙️ 설정" 패널에서 전부 조정할 수 있습니다** — 기본 백엔드, 동시
실행 수, 작업 제한 시간, Figma 토큰(MCP 없이 쓰는 REST API 폴백). 저장 위치는
`data/settings.json`(git 제외)이고, 별도 환경변수 지식 없이 사용 가능합니다.

> ⚠️ **Figma REST 폴백의 한도** — 토큰 발급 자체는 무료지만, 한도는 토큰
> 소유자가 아니라 **디자인 파일이 속한 플랜**을 따릅니다. 파일이 **무료(Starter)
> 플랜**에 있으면 그 파일에 대한 요청이 **월 6회**로 제한됩니다
> ([Figma rate limits](https://developers.figma.com/docs/rest-api/rate-limits)).
> 변환 한 번에 노드 조회 + 렌더 이미지로 여러 번 쓰고 재시도까지 하면 금방
> 넘기므로, 무료 플랜 파일에는 사실상 쓸 수 없습니다. Professional 이상
> 플랜(분당 15~20회)에 있는 파일이면 실용적입니다.
> 또한 REST 폴백 경로는 **실전 검증 기록이 없습니다** — 품질 수치(PASS 97%대)는
> 모두 Figma MCP 경로 기준입니다.

Figma 토큰은 **저장하는 순간 실제 API로 검증**되므로, 오타를
잡 실패가 아니라 저장 시점에 알 수 있습니다. 백엔드별 연동 상태 진단·키
입력·연동 테스트는 **🔌 백엔드 연동 패널**에서 합니다. 준비되지 않은 백엔드를
선택하면 폼에서 미리 경고합니다.

<details>
<summary>고급: 환경변수 오버라이드 (스크립트/CI용 — 화면 설정이 우선)</summary>

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AGENT_PROVIDER` | `claude-code` | 기본 백엔드 |
| `MAX_CONCURRENT_JOBS` | `2` | 동시 실행 잡 수 제한 |
| `JOB_TIMEOUT_MS` | `2700000` (45분) | 잡 하드 타임아웃 |
| `FIGMA_TOKEN` | - | Figma REST API 폴백 토큰 |
| `CLAUDE_BIN` / `CODEX_BIN` / `ANTIGRAVITY_BIN` | PATH 탐색 | CLI 바이너리 경로 고정 |

</details>

## 문제가 생겼을 때 (전달용 파일)

**작업 히스토리** 제목 오른쪽의 **"문제 신고용 파일 내려받기"**를 누르면 압축 파일
하나가 내려받아집니다. 그 파일을 메일이나 메신저에 그대로 첨부해 담당자에게 보내면
됩니다 — 폴더를 뒤질 필요도, 무엇이 문제인지 알아낼 필요도 없습니다.
작업 페이지에서 누르면 그 작업의 로그까지 함께 담깁니다.

담기는 것: 환경 점검·백엔드 진단 결과, OS/Node/Chrome/Python 버전,
서버에서 난 오류 로그, 런처의 설치·빌드 기록, (선택한 작업의) 이벤트 로그와
검증 결과, 산출물 목록.
**Figma 토큰과 API 키는 값이 제외됩니다** (설정 여부와 길이만 표시).
Figma URL과 작업 요약·로그 본문은 포함되니, 외부에 보낼 때는 참고하세요.

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 로그에 `FATAL: Figma MCP ...` | 헤드리스 세션에서 Figma MCP 미연결 — 🔌 백엔드 연동 패널의 "Figma 접근" 단계 안내대로 재연결 |
| `claude 실행 실패: spawn claude ENOENT` | CLI 미설치 또는 PATH 문제 — `which claude` 확인, 필요 시 `CLAUDE_BIN=/절대/경로` env 지정 |
| 런처 창에 "25253번으로 시작합니다" | 정상입니다 — 기본 포트를 다른 프로그램이 써서 옆 포트로 자동 전환한 것 (브라우저도 그 주소로 열립니다) |
| 시작하기.command가 설치/빌드에서 멈춤 | 폴더에 생기는 `시작-기록.log`를 관리자에게 보내주세요 (실패 원인이 그대로 담깁니다) |
| 앱은 켜지는데 뭔가 안 됨 | **"문제 신고용 파일 내려받기"**(작업 히스토리 오른쪽)로 압축 파일을 받아 담당자에게 전달 |
| 잡이 `failed: 서버가 재시작되어…` | dev 서버 재시작으로 중단된 잡 — "다시 실행" 버튼으로 재실행 |
| 픽셀 검증에서 계속 FAIL 반복 | 대부분 스킬 `references/gotchas.md`에 있는 케이스 — 로그의 compare 출력 확인 |
| 다운로드 zip에 파일이 없음 | 잡이 succeeded 인지 확인 — 실패한 잡은 output/ 이 비어 있을 수 있음 |

## 구조 (에이전트 백엔드 교체 가능)

```
lib/providers/types.ts         AgentProvider 인터페이스 — 백엔드 계약
lib/providers/claude-code.ts   claude -p stream-json (기본 백엔드)
lib/providers/codex.ts         codex exec --json (ChatGPT 구독)
lib/providers/antigravity.ts   agy -p --output-format stream-json (Google 구독)
lib/providers/mock.ts          샘플 산출물 (개발/검증용)
lib/providers/jsonl-cli.ts     공용 spawn 러너 (프로세스 그룹 정리 포함)
lib/providers/prompt.ts        공용 eDM 프롬프트 + Figma REST 폴백 절
lib/providers/registry.ts      백엔드 등록/기본값 선택
lib/setup.ts               백엔드 연동 진단 · 연동 테스트 · 키 검증
lib/jobs/                  파일시스템 잡 스토어 + 실행 러너
lib/hosting.ts             CDN 교체본 ({folder}/{file} 템플릿 치환)
lib/email-check.ts         발송 전 정적 검사 7종
app/api/**                 잡 CRUD/SSE/다운로드 · 설정 · 연동 라우트 (zod 검증)
data/jobs/<id>/work/output/    다운로드 대상 산출물 (git 제외)
```

새 백엔드 추가는 "파일 1개 + 등록 1줄"보다 손이 더 갑니다 — `AgentProvider`
구현과 `registry.ts` 등록 외에 `lib/setup.ts`에 진단 로직을 추가하고 그
로스터에도 등록해야 하며, 이걸 빠뜨리면 그 백엔드는 홈 화면에 "준비 안 됨"
경고조차 뜨지 않는 채로 나갑니다 (실제로 한 번 그렇게 나간 적 있음). UI 표시
이름·스모크 테스트·이 문서까지 같이 손봐야 하는 항목입니다. 기본 백엔드는
⚙️ 설정 패널(또는 `AGENT_PROVIDER` env)로 지정합니다 (`claude-code` | `codex`
| `antigravity` | `mock`).

## 테스트

```bash
pnpm vitest run     # 유닛 테스트 (URL/파서/잡 스토어/품질 게이트/CDN 치환/연동 진단)

# 실제 CLI spawn 스모크 (각 백엔드, 토큰 소량 소모 — 옵트인)
RUN_CLAUDE_SMOKE=1      pnpm vitest run lib/providers/claude-code.smoke.test.ts
RUN_CODEX_SMOKE=1       pnpm vitest run lib/providers/codex.smoke.test.ts
RUN_ANTIGRAVITY_SMOKE=1 pnpm vitest run lib/providers/antigravity.smoke.test.ts
```

UI에서 백엔드별 **"연동 테스트"** 버튼을 눌러도 같은 검증이 됩니다.

## AI 작업 준비 (Next.js 16.2)

- `AGENTS.md` + `CLAUDE.md` — 에이전트가 `node_modules/next/dist/docs/`의
  버전 일치 문서를 먼저 읽도록 지시
- `next.config.ts` — `logging.browserToTerminal: true` (브라우저 콘솔 → 터미널)
- `.next/dev/lock` — dev 서버 중복 실행 시 PID 안내 (16.2 기본)
- `vercel-labs/next-browser` 스킬은 저장소의 SKILL.md frontmatter 누락으로
  `npx skills add`가 거부(2026-07-28 기준) — 브라우저 검증은 chrome-devtools
  MCP로 대체

## 설계 문서

`docs/superpowers/specs/2026-07-28-marketing-html-maker-design.md`
