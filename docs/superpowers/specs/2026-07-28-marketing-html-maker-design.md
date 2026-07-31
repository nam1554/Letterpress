# Marketing HTML Maker — 설계 문서

날짜: 2026-07-28
상태: 자율 실행 모드로 확정 (사용자 요청: "개발을 완료해줘" — 결정 사항은 본 문서에 기록)

## 목적

로컬 브라우저에서 Figma eDM 디자인 링크를 입력하면, Claude Code가 기존
`figma-edm` 스킬 파이프라인(Figma 프레임 → 이메일 안전 HTML → 픽셀 검증 →
반응형 변형)을 헤드리스로 실행하고, 결과 HTML을 다운로드할 수 있게 하는
**로컬 전용** Next.js 앱. 서비스용이 아니며 인증/멀티유저/배포 고려 없음.

참고 산출물: `(사내 참고 산출물 — 로컬 경로, 저장소에 포함되지 않음)`
(700px 테이블 레이아웃, 인라인 스타일, 이미지 상대경로/셀프컨테인 2종, images/ 폴더)

## 성공 기준

1. 브라우저에서 Figma URL 제출 → 작업 진행 로그가 실시간 표시 → 완료 시
   HTML(및 images 폴더)을 zip으로 다운로드.
2. 에이전트 백엔드가 인터페이스 하나로 격리되어 있어, Claude Code 외의 CLI
   에이전트(Codex, Gemini 등)를 파일 1개 추가로 붙일 수 있다.
3. Mock 프로바이더로 토큰 소모 없이 전체 UI 루프를 검증할 수 있다.

## 아키텍처

```
app/
  page.tsx                # 홈: URL 입력 폼 + 작업 히스토리
  jobs/[id]/page.tsx      # 작업 상세: 라이브 로그(SSE) + 아티팩트 다운로드
  api/jobs/route.ts       # POST 작업 생성 / GET 목록
  api/jobs/[id]/route.ts  # GET 상태+아티팩트 목록
  api/jobs/[id]/events/route.ts    # GET SSE 이벤트 스트림
  api/jobs/[id]/download/route.ts  # GET zip 또는 개별 파일
lib/
  providers/
    types.ts              # AgentProvider / AgentTask / AgentEvent 인터페이스
    claude-code.ts        # claude -p --output-format stream-json 서브프로세스
    mock.ts               # 샘플 산출물 복사 + 지연 이벤트 (개발/검증용)
    registry.ts           # env AGENT_PROVIDER 로 선택 (기본 claude-code)
  jobs/
    store.ts              # 파일시스템 잡 스토어 (data/jobs/<id>/job.json + events.ndjson)
    runner.ts             # 잡 라이프사이클: 생성→실행→이벤트 기록→완료/실패
  figma.ts                # Figma URL 파싱 (fileKey, nodeId 추출/검증)
data/jobs/<id>/
  job.json                # 상태 스냅샷
  events.ndjson           # 이벤트 로그 (SSE 재접속 시 리플레이)
  work/                   # 에이전트 cwd
    output/               # 최종 아티팩트 (다운로드 대상)
```

- 잡 상태는 인메모리 Map + 파일 동기화. 서버 재시작 시 파일에서 복원(실행 중이던
  잡은 failed 처리).
- SSE는 events.ndjson 리플레이 후 라이브 이벤트 구독. 폴링 fallback 불필요(로컬).

## Provider 계약

```ts
interface AgentTask {
  jobId: string;
  figmaUrl: string;        // 검증된 Figma 디자인 URL
  workDir: string;         // 에이전트 cwd. output/ 에 산출물 기록 규약
  promptOverride?: string; // 개발/스모크 테스트용
}
interface AgentEvent { ts: number; type: "status"|"log"|"tool"|"error"|"done"; text: string; }
interface AgentProvider {
  id: string; label: string;
  run(task: AgentTask, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<{ ok: boolean; summary: string }>;
}
```

- **ClaudeCodeProvider**: `claude -p <prompt> --output-format stream-json --verbose
  --permission-mode bypassPermissions` 를 workDir cwd로 spawn. stream-json 라인을
  AgentEvent로 변환. 프롬프트는 figma-edm 스킬 사용 + `output/`에
  `*_figma.html`, `*_responsive.html`, `images/` 산출 지시.
- **MockProvider**: 번들 샘플(aisurfer 산출물 축약본)을 output/에 복사, 단계별
  이벤트를 지연 발행. `AGENT_PROVIDER=mock`.
- 새 백엔드 추가 = providers/에 파일 1개 + registry 등록 1줄.

## 트레이드오프 / 결정

- **잡 실행을 Next 프로세스 내 spawn으로** (별도 워커 데몬 없음): 로컬 단일
  사용자 도구라 충분. dev 서버 재시작 시 실행 중 잡이 죽는 건 수용(failed 표시).
- **DB 없음**: 파일시스템이 곧 상태. 잡 폴더를 지우면 히스토리 삭제.
- **헤드리스 Claude의 Figma 접근**: claude.ai Figma MCP는 헤드리스에서 빠질 수
  있음 → 프롬프트에 Figma MCP 부재 시 실패를 명시적으로 보고하도록 지시하고,
  이벤트 로그로 사용자에게 노출. (필요 시 Figma REST API 프로바이더는 후속 과제)
- **zip 생성**: `archiver` 사용 (검증된 패키지, 스트리밍 지원).

## AI 작업 준비 (Next 16.2)

- `AGENTS.md`(nextjs-agent-rules 블록) + `CLAUDE.md`(`@AGENTS.md`)
- `next.config.ts`: `logging.browserToTerminal: true`
- `npx skills add vercel-labs/next-browser` 설치
- 검증 루프: chrome-devtools MCP로 브라우저 구동 → 스크린샷/콘솔 확인 → 수정 반복

## 테스트 전략

1. 유닛: figma.ts URL 파싱, store 라이프사이클 (vitest).
2. E2E 루프: mock 프로바이더로 제출→로그→다운로드 zip 검증 (chrome-devtools MCP).
3. 실 프로바이더 스모크: promptOverride로 trivial 프롬프트 실행하여 spawn/stream
   파이프 검증 (전체 figma-edm 실행은 비용이 커서 수동 1회 권장).
