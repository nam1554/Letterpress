/**
 * 처음 받은 사람에게 보여줄 준비 절차 — **백엔드마다 다르다.**
 *
 * 왜 갈라야 하는가: 세 백엔드의 Figma 접근 경로가 서로 다르다. claude-code와
 * codex는 원격 MCP(`mcp.figma.com`) OAuth를 쓰고, antigravity는 MCP 경로가
 * 아예 없어 REST 토큰이 유일하다(실측). 이걸 "② Figma 연결" 한 줄로 뭉뚱그리면
 * 팀원은 자기한테 뭐가 필요한지 알 수 없고, 없는 설정을 찾아 헤맨다.
 *
 * 화면 문구만 담은 순수 데이터라 테스트로 고정할 수 있다 — 백엔드가 늘면
 * `first-run.test.ts`가 빠진 안내를 잡아낸다.
 */

export interface FirstRunStep {
  title: string;
  body: string;
  /** 복사해 터미널에 붙여넣을 수 있는 명령 (있을 때만). */
  command?: string;
}

/** 모든 백엔드가 공유하는 마지막 단계 — 준비가 끝난 뒤 실제로 하는 일. */
// 본문은 마크다운이 아니라 평문으로 렌더된다 — 백틱을 쓰면 그대로 보인다.
// 명령은 body가 아니라 command(복사 칩)로 준다.
const RUN_STEP: FirstRunStep = {
  title: "Figma 링크를 붙여넣고 실행",
  body: "위 단계가 모두 초록불이 되면 아래 '새 변환'에 Figma 디자인 링크를 붙여넣고 실행하세요. 링크에 node-id 값이 있어야 합니다 — Figma에서 프레임을 선택하고 우클릭 → Copy link to selection 하면 붙습니다. 변환은 3~20분 걸립니다 (백엔드마다 다름).",
};

const STEPS: Record<string, FirstRunStep[]> = {
  "claude-code": [
    {
      title: "Claude Code CLI 설치 후 로그인",
      body: "설치한 뒤 아래 명령을 터미널에서 한 번 실행하면 로그인이 진행됩니다. 설치 명령은 아래 '백엔드 연동'에서 복사할 수 있어요.",
      command: "claude",
    },
    {
      title: "claude.ai Figma 커넥터 연결",
      body: "claude.ai에서 Figma 커넥터를 연결하세요. Claude Code 대화에 Figma 링크를 넣어 내용이 읽히면 정상입니다.",
    },
    RUN_STEP,
  ],
  codex: [
    {
      title: "Codex CLI 설치 후 로그인",
      body: "ChatGPT 구독 계정으로 로그인합니다. 아래 명령을 터미널에 붙여넣으세요.",
      command: "npm i -g @openai/codex && codex login",
    },
    {
      title: "Figma 등록",
      body: "아래 명령을 실행하면 브라우저에서 Figma 로그인 창이 열립니다. 한 번만 하면 됩니다.",
      command: "codex mcp add figma --url https://mcp.figma.com/mcp",
    },
    RUN_STEP,
  ],
  antigravity: [
    {
      title: "Antigravity CLI 설치 후 로그인",
      body: "antigravity.google.com/download 에서 설치한 뒤, 아래 명령을 터미널에서 한 번 실행해 구글 계정으로 로그인하세요.",
      command: "agy",
    },
    {
      title: "Figma 개인 토큰 저장",
      body: "figma.com → Settings → Security → Personal access tokens 에서 토큰을 발급해 아래 '설정'의 'Figma 토큰' 칸에 저장하세요. 이 백엔드는 Figma 커넥터를 붙일 수 있는 경로가 없어서 토큰이 유일한 방법입니다.",
    },
    RUN_STEP,
  ],
  mock: [
    {
      title: "준비할 것이 없습니다",
      body: "Mock은 구독도 로그인도 필요 없습니다. 미리 만들어 둔 샘플 결과물로 화면 흐름과 다운로드까지 그대로 확인할 수 있습니다.",
    },
    {
      title: "아무 Figma 링크나 붙여넣고 실행",
      body: "링크 내용은 쓰이지 않습니다 — 형식만 맞으면 됩니다. 결과물은 항상 같은 샘플입니다.",
    },
  ],
};

/**
 * 백엔드별 준비 절차. 모르는 id면 빈 배열 — 화면은 안내 자체를 감춘다.
 * (없는 절차를 지어내 보여주는 것보다 아무것도 안 보이는 편이 낫다.)
 */
export function firstRunSteps(backendId: string): FirstRunStep[] {
  return STEPS[backendId] ?? [];
}

/** 안내가 준비된 백엔드 id 목록 — 테스트가 누락을 잡는 데 쓴다. */
export function backendsWithFirstRun(): string[] {
  return Object.keys(STEPS);
}

export interface SubscriptionPick {
  id: string;
  /** 화면에 보이는 이름 — 팀원은 CLI 이름이 아니라 구독을 갖고 있다. */
  subscription: string;
}

/**
 * "어떤 구독을 갖고 계세요?" 선택지.
 *
 * 컴포넌트가 아니라 여기 두는 이유: 백엔드를 추가하고 이 목록을 빼먹으면
 * 그 구독을 가진 팀원은 자기 선택지를 화면에서 찾을 수 없다. 순수 데이터로
 * 두면 테스트가 registry와 대조해 누락을 잡는다.
 */
export const SUBSCRIPTION_PICKS: SubscriptionPick[] = [
  { id: "claude-code", subscription: "Claude" },
  { id: "codex", subscription: "ChatGPT" },
  { id: "antigravity", subscription: "Google" },
  { id: "mock", subscription: "아직 없음" },
];
