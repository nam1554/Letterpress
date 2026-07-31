/**
 * 실패한 잡의 원인 분류.
 *
 * 왜 필요한가: 실패 요약은 CLI가 뱉은 영어 원문이 그대로 실린다. 비개발자
 * 팀원에게 `You've hit your usage limit. Upgrade to Plus...`는 "뭘 하라는
 * 건지 모르겠다"와 같은 말이고, 가장 흔한 실패(구독 한도)가 하필 **다른
 * 구독으로 돌리면 바로 풀리는** 문제라 안내 하나로 해결률이 크게 갈린다.
 *
 * 판정은 실패 요약 문자열 매칭이다. 아래 패턴 중 **실측으로 확인된 것**은
 * 주석에 `실측`으로 표시했다. 나머지는 각 CLI가 통상 쓰는 표현을 보고 넣은
 * 방어적 패턴이며, 걸리지 않으면 `unknown`으로 떨어져 진단 파일 안내로
 * 이어진다 — 틀린 원인을 자신 있게 말하는 것보다 모른다고 하는 편이 낫다.
 */

export type FailureKind =
  | "cancelled"
  | "timeout"
  | "gate"
  | "quota"
  | "auth"
  | "figma"
  | "cli-missing"
  | "unknown";

export interface FailureDiagnosis {
  kind: FailureKind;
  /** 한 줄 원인 — 화면 제목으로 쓴다. */
  title: string;
  /** 무슨 일이 일어난 것인지. */
  detail: string;
  /** 지금 할 수 있는 것, 순서대로. */
  actions: string[];
  /** 다른 백엔드로 다시 돌리는 것이 실제 해법인가. */
  switchBackend: boolean;
  /** '이어서 실행'(같은 작업 폴더 재사용)이 의미 있는가. */
  resume: boolean;
}

/**
 * 취소·시간 초과·게이트는 러너가 직접 쓰는 한국어 문구라 정확히 맞출 수 있다
 * (`lib/jobs/runner.ts`). 나머지는 CLI 원문이 실려 온다.
 */
const CANCELLED = /사용자가 취소했습니다/;
const TIMEOUT = /제한 시간.*초과/;
const GATE = /품질 게이트 미충족/;

/** 실측: codex `You've hit your usage limit. Upgrade to Plus to continue using Codex` */
const QUOTA = /usage limit|rate.?limit|quota|upgrade to (plus|pro)|too many requests|\b429\b|사용량 한도|한도를 초과/i;

/** 방어적 — 각 CLI의 미로그인 안내에 통상 등장하는 표현. */
const AUTH = /not (logged in|authenticated)|log ?in required|please run [`'"]?\w+ login|unauthorized|authentication failed|\b401\b|로그인이 필요/i;

/**
 * 실측: antigravity `FATAL: Figma access is not available (Figma MCP tools are
 * not present and FIGMA_TOKEN API token is missing)`
 *
 * "figma"만으로 잡으면 안 된다 — **산출물 파일 이름이 `*_figma.html`** 이라
 * 파일 관련 오류가 전부 Figma 접근 문제로 둔갑한다. 바로 뒤에 오는 낱말
 * (access/token/mcp/auth/login)이나 근처의 한국어 단어까지 함께 요구한다.
 */
const FIGMA =
  /FIGMA_TOKEN|figma[\s_-]*(access|token|mcp|auth\w*|login)|figma[^\n]{0,20}(권한|접근|토큰)/i;

/** 방어적 — CLI 자체가 없을 때 execa/Node가 내는 형태. */
const CLI_MISSING = /\bENOENT\b|command not found|is not recognized as an internal/i;

/** 백엔드마다 Figma 접근 경로가 다르다 — 없는 선택지를 안내하면 안 된다. */
function figmaActions(provider: string): string[] {
  if (provider === "antigravity") {
    return [
      "⚙️ 설정 패널의 'Figma 토큰' 칸에 개인 액세스 토큰을 저장하세요. figma.com → Settings → Security → Personal access tokens 에서 발급합니다.",
      "이 백엔드는 Figma 커넥터(MCP) 연결 경로가 없어서 토큰이 유일한 방법입니다.",
    ];
  }
  if (provider === "codex") {
    return [
      "터미널에서 codex mcp add figma --url https://mcp.figma.com/mcp 를 실행해 Figma를 등록하세요 (브라우저에서 로그인 창이 열립니다).",
      "🔌 백엔드 연동 패널의 '연동 테스트'로 등록됐는지 확인할 수 있습니다.",
    ];
  }
  if (provider === "claude-code") {
    return [
      "claude.ai의 Figma 커넥터가 연결돼 있는지 확인하세요 — Claude Code 대화에서 Figma 링크가 읽히면 정상입니다.",
      "무료 플랜이 아닌 Figma 파일이라면 ⚙️ 설정에 Figma 토큰을 넣는 우회 경로도 있습니다.",
    ];
  }
  return ["🔌 백엔드 연동 패널에서 이 백엔드의 'Figma 접근' 단계를 확인하세요."];
}

/**
 * 실패 요약을 읽고 원인과 다음 행동을 제시한다.
 *
 * @param summary 잡의 `summary` (러너가 기록한 실패 사유)
 * @param provider 잡을 돌린 백엔드 id — Figma 안내가 백엔드마다 다르다
 */
export function diagnoseFailure(
  summary: string | undefined,
  provider: string,
): FailureDiagnosis {
  const s = summary ?? "";

  if (CANCELLED.test(s)) {
    return {
      kind: "cancelled",
      title: "직접 취소한 작업입니다",
      detail: "실패가 아니라 사용자가 중단한 작업입니다.",
      actions: ["'이어서 실행'을 누르면 중간까지 만든 결과물을 재사용해 남은 부분만 진행합니다."],
      switchBackend: false,
      resume: true,
    };
  }

  if (TIMEOUT.test(s)) {
    return {
      kind: "timeout",
      title: "제한 시간을 넘겼습니다",
      detail:
        "작업이 끝나기 전에 제한 시간에 걸려 중단됐습니다. 중간 산출물은 그대로 남아 있습니다.",
      actions: [
        "'이어서 실행'을 누르세요 — 처음부터 다시 만들지 않고 남은 부분만 이어서 진행합니다.",
        "계속 시간이 모자라면 ⚙️ 설정에서 '작업 제한 시간'을 늘리세요.",
        "더 빠른 백엔드로 바꾸는 것도 방법입니다 (Codex·Antigravity는 3~4분, Claude Code는 15분 안팎).",
      ],
      switchBackend: true,
      resume: true,
    };
  }

  if (GATE.test(s)) {
    return {
      kind: "gate",
      title: "결과물이 품질 기준에 못 미쳤습니다",
      detail:
        "산출물은 만들어졌지만 검사를 통과하지 못했습니다. 자동 보수를 1회 시도한 뒤의 결과입니다.",
      actions: [
        "'이어서 실행'을 누르면 지금 남은 미충족 항목만 다시 손봅니다.",
        "반복해서 같은 항목에서 막히면 다른 백엔드로 돌려 보세요 — 디자인에 따라 잘 맞는 백엔드가 다릅니다.",
      ],
      switchBackend: true,
      resume: true,
    };
  }

  if (QUOTA.test(s)) {
    return {
      kind: "quota",
      title: "구독 사용량 한도에 걸렸습니다",
      detail:
        "이 백엔드에 연결된 구독의 사용량을 다 썼습니다. 앱이나 설정 문제가 아니라 계정 한도입니다.",
      actions: [
        "다른 구독의 백엔드로 다시 돌리는 것이 가장 빠릅니다 — 세 백엔드 모두 같은 품질 기준을 통과합니다.",
        "한도가 회복될 때까지 기다렸다가 '이어서 실행'을 눌러도 됩니다.",
      ],
      switchBackend: true,
      resume: true,
    };
  }

  // FIGMA를 AUTH보다 먼저 본다. 둘 다 걸리는 문구("Figma authentication
  // failed")가 실제로 있을 수 있는데, 그때 필요한 건 "CLI에 로그인하세요"가
  // 아니라 그 백엔드의 Figma 연결 방법이다 — 더 구체적인 쪽이 이긴다.
  if (FIGMA.test(s)) {
    return {
      kind: "figma",
      title: "Figma 디자인을 읽지 못했습니다",
      detail:
        "백엔드가 Figma 파일에 접근하지 못했습니다. 연결이 안 됐거나, 이 파일을 볼 권한이 없습니다.",
      actions: [
        ...figmaActions(provider),
        "본인 계정으로 해당 Figma 파일이 열리는지도 확인하세요 — 권한이 없으면 어떤 백엔드로도 읽지 못합니다.",
      ],
      switchBackend: false,
      resume: true,
    };
  }

  if (AUTH.test(s)) {
    return {
      kind: "auth",
      title: "로그인이 필요합니다",
      detail: "백엔드 CLI가 로그인되어 있지 않습니다.",
      actions: [
        "터미널에서 해당 CLI를 한 번 실행해 로그인하세요 — 명령은 🔌 백엔드 연동 패널에서 복사할 수 있습니다.",
        "로그인 뒤 '연동 테스트'로 확인한 다음 '이어서 실행'을 누르세요.",
      ],
      switchBackend: true,
      resume: true,
    };
  }

  if (CLI_MISSING.test(s)) {
    return {
      kind: "cli-missing",
      title: "백엔드 CLI를 찾지 못했습니다",
      detail: "선택한 백엔드의 명령어가 설치돼 있지 않거나 PATH에 없습니다.",
      actions: [
        "🔌 백엔드 연동 패널의 'CLI 설치' 단계에 설치 명령이 있습니다 — 복사해 터미널에 붙여넣으세요.",
        "이미 설치했다면 터미널을 새로 열고 앱을 다시 시작해 보세요 (PATH가 갱신되지 않았을 수 있습니다).",
      ],
      switchBackend: true,
      resume: true,
    };
  }

  return {
    kind: "unknown",
    title: "원인을 자동으로 판별하지 못했습니다",
    detail:
      "알려진 실패 유형에 해당하지 않습니다. 아래 진행 로그에 원문이 남아 있습니다.",
    actions: [
      "'문제 신고용 파일 내려받기'를 눌러 받은 파일을 담당자에게 보내주세요 — 무엇이 문제인지 직접 알아낼 필요 없습니다.",
      "일시적인 문제일 수 있으니 '이어서 실행'을 한 번 눌러 보는 것도 방법입니다.",
    ],
    switchBackend: true,
    resume: true,
  };
}
