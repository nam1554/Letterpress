# Marketing HTML Maker

Figma eDM 디자인 링크를 붙여넣으면 **Claude Code가 헤드리스로 이메일 HTML을
생성**하고, 브라우저에서 결과물(HTML + images/)을 zip으로 다운로드하는 **로컬
전용** 도구입니다. 서비스 배포용이 아닙니다.

생성 파이프라인은 사용자 홈의 `figma-edm` 스킬(픽셀 검증 포함)을 그대로
사용하며, 목표 산출물 형태는 `(로컬 참고 산출물 — 저장소에 없음)`
패키지와 동일합니다 (700px 테이블 레이아웃, `images/` 상대경로, 반응형 변형).

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

1. 홈에서 Figma 디자인 URL 입력 (`figma.com/design/...?node-id=...`)
2. 프로바이더 선택 후 "HTML 만들기"
   - **Claude Code (local CLI)** — 실제 변환. `claude` CLI가 설치·로그인돼 있어야
     하며, figma-edm 스킬이 Figma MCP에 접근할 수 있어야 합니다.
     (헤드리스 세션에서 Figma MCP가 빠져 있으면 로그에 FATAL로 표시됩니다)
   - **Mock** — 토큰 소모 없이 UI/다운로드 플로우 확인용 샘플 산출물
3. 작업 페이지에서 실시간 로그(SSE) 확인 → 완료 후 미리보기 / 개별 다운로드 /
   전체 zip

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
