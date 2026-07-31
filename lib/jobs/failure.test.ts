import { describe, expect, it } from "vitest";
import { diagnoseFailure, type FailureKind } from "./failure";

/** 실측 문자열 — 실제 실행에서 받아 적은 것. 여기가 흔들리면 분류가 흔들린다. */
const MEASURED = {
  /** codex, 2026-07-31 (구독 없이 실행) */
  codexQuota:
    "You've hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Aug 27th, 2026.",
  /** antigravity, 2026-07-31 (FIGMA_TOKEN 없이 실행 — 47초 만에 종료) */
  agyFigma:
    "FATAL: Figma access is not available (Figma MCP tools are not present and FIGMA_TOKEN API token is missing)",
};

/** 러너가 직접 쓰는 문구 — `lib/jobs/runner.ts`와 일치해야 한다. */
const RUNNER = {
  cancelled: "사용자가 취소했습니다.",
  timeout: "제한 시간(40분)을 초과해 중단되었습니다.",
  gate: "품질 게이트 미충족: verify.json 없음 / 살아있는 텍스트 0자",
};

const kindOf = (summary: string, provider = "codex"): FailureKind =>
  diagnoseFailure(summary, provider).kind;

describe("diagnoseFailure — 실측 문자열", () => {
  it("codex 사용량 한도를 quota로 분류한다", () => {
    expect(kindOf(MEASURED.codexQuota)).toBe("quota");
  });

  it("한도 실패에는 다른 백엔드 전환을 권한다", () => {
    // 이 앱의 존재 이유 중 하나 — 한 구독이 막혀도 다른 구독으로 끝낼 수 있다.
    expect(diagnoseFailure(MEASURED.codexQuota, "codex").switchBackend).toBe(true);
  });

  it("antigravity Figma 실패를 figma로 분류한다", () => {
    expect(kindOf(MEASURED.agyFigma, "antigravity")).toBe("figma");
  });

  it("Figma 실패는 백엔드 전환을 권하지 않는다", () => {
    // 파일 권한이 없으면 어떤 백엔드로 바꿔도 똑같이 실패한다.
    expect(diagnoseFailure(MEASURED.agyFigma, "antigravity").switchBackend).toBe(false);
  });
});

describe("diagnoseFailure — 러너가 쓰는 문구", () => {
  it.each([
    [RUNNER.cancelled, "cancelled"],
    [RUNNER.timeout, "timeout"],
    [RUNNER.gate, "gate"],
  ] as const)("%s → %s", (summary, kind) => {
    expect(kindOf(summary)).toBe(kind);
  });

  it("취소는 실패로 읽히지 않게 안내한다", () => {
    const d = diagnoseFailure(RUNNER.cancelled, "codex");
    expect(d.title).not.toMatch(/실패/);
    expect(d.switchBackend).toBe(false);
  });

  it("게이트 미충족보다 취소·시간 초과를 먼저 본다", () => {
    // 시간 초과로 끊긴 잡의 요약에 게이트 문구가 섞여도 원인은 시간 초과다.
    expect(kindOf(`${RUNNER.timeout} ${RUNNER.gate}`)).toBe("timeout");
  });
});

describe("diagnoseFailure — 나머지 유형", () => {
  it.each([
    ["Error: rate limit exceeded", "quota"],
    ["HTTP 429 Too Many Requests", "quota"],
    ["Not logged in. Please run `codex login` first.", "auth"],
    ["Request failed with status 401 Unauthorized", "auth"],
    ["spawn agy ENOENT", "cli-missing"],
    ["zsh: command not found: codex", "cli-missing"],
  ] as const)("%s → %s", (summary, kind) => {
    expect(kindOf(summary)).toBe(kind);
  });

  it("Figma와 로그인이 함께 걸리면 더 구체적인 Figma를 고른다", () => {
    // "CLI에 로그인하세요"보다 "이 백엔드의 Figma 연결은 이렇게 합니다"가
    // 실제로 막힌 지점에 가깝다.
    expect(kindOf("Figma authentication failed", "codex")).toBe("figma");
  });

  it("산출물 파일명의 'figma'를 Figma 접근 문제로 오해하지 않는다", () => {
    // 산출물 이름이 aisurfer_figma.html이다 — 'figma'만 보고 분류하면
    // 파일 쓰기 오류가 전부 "Figma를 읽지 못했습니다"로 둔갑한다.
    expect(kindOf("EACCES: permission denied, open 'output/aisurfer_figma.html'")).not.toBe(
      "figma",
    );
  });

  it("알 수 없는 실패는 unknown으로 두고 진단 파일을 안내한다", () => {
    const d = diagnoseFailure("Segmentation fault (core dumped)", "codex");
    expect(d.kind).toBe("unknown");
    // 원인을 지어내지 않고, 팀원이 실제로 할 수 있는 일을 준다.
    expect(d.actions.join(" ")).toMatch(/문제 신고용 파일/);
  });

  it("요약이 비어 있어도 터지지 않는다", () => {
    expect(diagnoseFailure(undefined, "codex").kind).toBe("unknown");
    expect(diagnoseFailure("", "codex").kind).toBe("unknown");
  });
});

describe("diagnoseFailure — 백엔드마다 다른 Figma 경로", () => {
  it("antigravity에는 토큰을 안내하고 MCP를 대안으로 제시하지 않는다", () => {
    // agy에는 Figma MCP 경로가 자체가 없다 — 있지도 않은 선택지를 안내하면
    // 팀원이 없는 설정을 찾아 헤맨다.
    const text = diagnoseFailure(MEASURED.agyFigma, "antigravity").actions.join(" ");
    expect(text).toMatch(/토큰/);
    // 등록 명령을 시키면 안 된다 — 실행할 수 있는 명령 자체가 없다.
    expect(text).not.toMatch(/mcp add/i);
    // MCP를 언급하더라도 "그 경로가 없다"는 사실을 말할 때만 허용된다.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/커넥터|MCP/i.test(sentence)) {
        expect(sentence, "MCP 언급은 부재를 알릴 때만 허용").toMatch(/없/);
      }
    }
  });

  it("codex에는 mcp add 명령을 안내한다", () => {
    const actions = diagnoseFailure(MEASURED.agyFigma, "codex").actions;
    expect(actions.join(" ")).toMatch(/codex mcp add figma/);
  });

  it("claude-code에는 커넥터 연결을 안내한다", () => {
    const actions = diagnoseFailure(MEASURED.agyFigma, "claude-code").actions;
    expect(actions.join(" ")).toMatch(/커넥터/);
  });

  it("안내 문구에 백틱을 쓰지 않는다", () => {
    // FailureHelp는 평문 Text로 렌더한다 — 마크다운이 아니라서 그대로 보인다.
    for (const provider of ["claude-code", "codex", "antigravity", "mock"]) {
      const d = diagnoseFailure(MEASURED.agyFigma, provider);
      expect(`${d.title} ${d.detail} ${d.actions.join(" ")}`, provider).not.toContain("`");
    }
  });

  it("모든 유형이 최소 한 가지 행동을 준다", () => {
    const summaries = [
      MEASURED.codexQuota,
      MEASURED.agyFigma,
      RUNNER.cancelled,
      RUNNER.timeout,
      RUNNER.gate,
      "Not logged in",
      "spawn agy ENOENT",
      "무엇인지 알 수 없는 오류",
    ];
    for (const s of summaries) {
      const d = diagnoseFailure(s, "codex");
      expect(d.actions.length, s).toBeGreaterThan(0);
      expect(d.title.length, s).toBeGreaterThan(0);
    }
  });
});
