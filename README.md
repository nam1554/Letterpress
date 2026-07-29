# Marketing HTML Maker

Figma eDM 디자인 링크를 붙여넣으면 **Claude Code가 헤드리스로 이메일 HTML을
생성**하고, 브라우저에서 결과물(HTML + images/)을 zip으로 다운로드하는 **로컬
전용** 도구입니다. 서비스 배포용이 아닙니다.

생성 파이프라인은 사용자 홈의 `figma-edm` 스킬(픽셀 검증 포함)을 그대로
사용하며, 목표 산출물 형태는 `(로컬 참고 산출물 — 저장소에 없음)`
패키지와 동일합니다 (700px 테이블 레이아웃, `images/` 상대경로, 반응형 변형).

## 팀원 온보딩 (처음 받은 사람용)

이 도구는 각자의 머신에서 각자의 Claude 구독으로 실행됩니다. 필요한 것:

1. **Claude Code CLI** — 설치 후 `claude` 실행해 로그인
   (변환 1회당 본인 구독의 토큰을 사용합니다. 통상 10~20분 소요)
2. **figma-edm 스킬** — `~/.claude/skills/figma-edm` 에 있어야 합니다
   (스킬 저장소를 클론 후 심링크: `ln -s <repo>/figma-edm ~/.claude/skills/figma-edm`)
3. **Figma MCP 연결** — Claude Code에 claude.ai Figma 커넥터가 연결·로그인돼
   있어야 합니다 (`claude` 대화에서 Figma 링크가 읽히는지 확인)
4. **Google Chrome** — 픽셀 검증(compare.py)이 헤드리스 Chrome을 사용
5. **Python 의존성** — `python3 -m pip install pillow numpy fonttools brotli`
6. **Node 20+ / pnpm** — 앱 실행용

홈 화면 상단의 **환경 점검 배너**가 1·2·4·5를 자동 진단해 주므로, 뜨는 안내대로
해결하면 됩니다.

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

상시 켜두고 쓰려면 프로덕션 모드가 더 안정적입니다 (HMR 재시작으로 실행 중
잡이 끊기는 일 없음):

```bash
pnpm build && pnpm start
```

1. 홈에서 Figma 디자인 URL 입력 (`figma.com/design/...?node-id=...`)
2. 프로바이더 선택 후 "HTML 만들기"
   - **Claude Code (local CLI)** — 기본. `claude` CLI 로그인 + claude.ai Figma
     커넥터 연결 필요. (헤드리스에서 Figma MCP가 빠지면 로그에 FATAL 표시)
   - **Gemini CLI (API 키)** — `npm i -g @google/gemini-cli` 후
     aistudio.google.com/apikey 에서 키를 발급해 ⚙️ 설정의 "Gemini API 키"에
     입력. (⚠️ 구글이 개인 무료 로그인 티어를 중단해 로그인 방식은 더 이상
     동작하지 않습니다 — 2026-07 확인. 모델은 용량이 안정적인
     `gemini-flash-latest` 기본, `GEMINI_MODEL`로 변경 가능.) Figma 접근은
     `gemini mcp add --transport http figma https://mcp.figma.com/mcp` 등록
     또는 Figma 토큰 REST 폴백.
   - **Codex CLI (ChatGPT 구독)** — `npm i -g @openai/codex`, `codex login`.
     Figma 접근은 `codex mcp add figma --url https://mcp.figma.com/mcp` (등록 시
     브라우저 OAuth).
   - **Mock** — 토큰 소모 없이 UI/다운로드 플로우 확인용 샘플 산출물

   Gemini/Codex는 figma-edm 스킬 파일을 프롬프트로 읽어 따라가는 **실험적**
   경로입니다 — 픽셀 검증 PASS 도달 품질은 Claude Code 기준으로 검증돼 있습니다.

   > ⚠️ **Gemini 데이터 취급 주의**: 개인 구글 계정 무료 티어는 프롬프트·코드가
   > 구글 모델 개선에 활용될 수 있습니다. 회사 eDM 디자인/카피를 다루므로,
   > Gemini를 쓸 경우 데이터 수집 옵트아웃을 켜거나 학습에 사용되지 않는 경로
   > (Workspace 계정·API 키·유료 플랜)를 사용하세요. 기본값인 Claude Code만
   > 써도 무방합니다.
3. 작업 페이지에서 실시간 로그(SSE) 확인 → 완료 후 미리보기 / 개별 다운로드 /
   전체 zip. 실행 중 취소, 완료 후 다시 실행·삭제 가능
4. **발송 준비** (완료된 작업에서):
   - **CDN 교체본** — images/를 CDN에 올린 뒤 URL 템플릿(`{file}`/`{name}`/`{ext}`)
     을 입력하면 src를 일괄 치환한 발송용 HTML을 `hosted/`에 생성
     (예: IIIF `https://…/edm__{name}/full/max/0/default.{ext}`. 템플릿은 설정에
     저장돼 다음 작업에서 재사용)
   - **발송 전 검사** — HTML 산출물별 "검사" 버튼: Gmail 102KB 클리핑,
     `<script>`, 이미지 alt, 배경 이미지(Outlook), http 링크, 프리헤더,
     상대경로 이미지 잔존 여부를 점검
   - **픽셀 검증 리포트** — Figma↔렌더 나란히 비교와 차이 히트맵을 잡
     페이지에서 바로 확인 (PASS의 시각적 근거)

## 설정

**홈 화면의 "⚙️ 설정" 패널에서 전부 조정할 수 있습니다** — 기본 백엔드, 동시
실행 수, 작업 제한 시간, Figma 토큰(무료 시트용 REST API 폴백). 저장 위치는
`data/settings.json`(git 제외)이고, 별도 환경변수 지식 없이 사용 가능합니다.

<details>
<summary>고급: 환경변수 오버라이드 (스크립트/CI용 — 화면 설정이 우선)</summary>

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AGENT_PROVIDER` | `claude-code` | 기본 백엔드 |
| `MAX_CONCURRENT_JOBS` | `2` | 동시 실행 잡 수 제한 |
| `JOB_TIMEOUT_MS` | `2700000` (45분) | 잡 하드 타임아웃 |
| `FIGMA_TOKEN` | - | Figma REST API 폴백 토큰 |
| `CLAUDE_BIN` / `GEMINI_BIN` / `CODEX_BIN` | PATH 탐색 | CLI 바이너리 경로 고정 |

</details>

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 로그에 `FATAL: Figma MCP ...` | 헤드리스 세션에서 Figma MCP 미연결 — `claude`에서 Figma 커넥터 로그인 확인 |
| `claude 실행 실패: spawn claude ENOENT` | CLI 미설치 또는 PATH 문제 — `which claude` 확인, 필요 시 `CLAUDE_BIN=/절대/경로` env 지정 |
| 잡이 `failed: 서버가 재시작되어…` | dev 서버 재시작으로 중단된 잡 — "다시 실행" 버튼으로 재실행 |
| 픽셀 검증에서 계속 FAIL 반복 | 대부분 스킬 `references/gotchas.md`에 있는 케이스 — 로그의 compare 출력 확인 |
| 다운로드 zip에 파일이 없음 | 잡이 succeeded 인지 확인 — 실패한 잡은 output/ 이 비어 있을 수 있음 |

## 구조 (에이전트 백엔드 교체 가능)

```
lib/providers/types.ts     AgentProvider 인터페이스 — 백엔드 계약
lib/providers/claude-code.ts   claude -p --output-format stream-json spawn
lib/providers/mock.ts          샘플 산출물 (개발/검증용)
lib/providers/registry.ts      env AGENT_PROVIDER 로 기본값 선택
lib/jobs/                  파일시스템 잡 스토어 + 실행 러너
app/api/jobs/**            생성/목록/상태/SSE/다운로드/미리보기 라우트
data/jobs/<id>/work/output/    다운로드 대상 산출물 (git 제외)
```

다른 구독 모델(Codex, Gemini CLI 등)로 바꾸려면 `lib/providers/`에
`AgentProvider` 구현 파일 1개를 추가하고 `registry.ts`에 등록하면 됩니다.
기본 프로바이더는 `AGENT_PROVIDER` 환경변수로 지정합니다 (`claude-code` | `mock`).

## 테스트

```bash
pnpm vitest run                 # 유닛 테스트 (URL 파싱 등)
RUN_CLAUDE_SMOKE=1 pnpm vitest run lib/providers/claude-code.smoke.test.ts
                                # 실제 claude CLI spawn 파이프 스모크 (토큰 소량 소모)
```

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
