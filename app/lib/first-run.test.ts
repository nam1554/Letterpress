import { describe, expect, it } from "vitest";
import { backendsWithFirstRun, firstRunSteps, SUBSCRIPTION_PICKS } from "./first-run";
import { listProviders } from "@/lib/providers/registry";

describe("firstRunSteps", () => {
  it("등록된 모든 백엔드에 준비 안내가 있다", () => {
    // 백엔드를 추가하고 안내를 빼먹으면 팀원은 그 백엔드를 고른 순간
    // 아무 설명 없는 빈 화면을 본다 — 여기서 막는다.
    const missing = listProviders()
      .map((p) => p.id)
      .filter((id) => firstRunSteps(id).length === 0);
    expect(missing).toEqual([]);
  });

  it("안내 목록에 유령 백엔드가 없다", () => {
    // 제거된 백엔드의 안내가 남아 있으면 없는 절차를 계속 보여주게 된다.
    const known = new Set(listProviders().map((p) => p.id));
    expect(backendsWithFirstRun().filter((id) => !known.has(id))).toEqual([]);
  });

  it.each(["claude-code", "codex", "antigravity"])("%s는 설치·Figma·실행을 덮는다", (id) => {
    const steps = firstRunSteps(id);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const text = steps.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(text).toMatch(/로그인/);
    expect(text).toMatch(/Figma/);
  });

  it("모르는 id는 빈 배열 — 없는 절차를 지어내지 않는다", () => {
    expect(firstRunSteps("does-not-exist")).toEqual([]);
  });

  it("본문에 백틱을 쓰지 않는다", () => {
    // 화면은 평문 Text로 렌더한다 — 마크다운이 아니라서 백틱이 그대로 보인다.
    // 명령은 body가 아니라 command(복사 칩)로 줘야 한다.
    for (const id of backendsWithFirstRun()) {
      for (const s of firstRunSteps(id)) {
        expect(`${s.title} ${s.body}`, `${id}: ${s.title}`).not.toContain("`");
      }
    }
  });

  it("모든 단계에 제목과 설명이 있다", () => {
    for (const id of backendsWithFirstRun()) {
      for (const s of firstRunSteps(id)) {
        expect(s.title.length, `${id}: ${s.title}`).toBeGreaterThan(0);
        expect(s.body.length, `${id}: ${s.title}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("SUBSCRIPTION_PICKS (구독 선택지)", () => {
  it("등록된 모든 백엔드가 선택지에 있다", () => {
    // 백엔드를 추가하고 여기를 빼먹으면, 그 구독을 가진 팀원은 첫 화면에서
    // 자기 선택지를 찾지 못한다.
    const picked = new Set(SUBSCRIPTION_PICKS.map((p) => p.id));
    expect(listProviders().map((p) => p.id).filter((id) => !picked.has(id))).toEqual([]);
  });

  it("선택지에 유령 백엔드가 없다", () => {
    const known = new Set(listProviders().map((p) => p.id));
    expect(SUBSCRIPTION_PICKS.filter((p) => !known.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it("모든 선택지에 준비 안내가 딸려 있다", () => {
    for (const p of SUBSCRIPTION_PICKS) {
      expect(firstRunSteps(p.id).length, p.id).toBeGreaterThan(0);
    }
  });

  it("CLI 이름이 아니라 구독 이름으로 보여준다", () => {
    // "Codex CLI"가 아니라 "ChatGPT" — 팀원은 자기가 결제한 것의 이름을 안다.
    const names = SUBSCRIPTION_PICKS.map((p) => p.subscription);
    expect(names).toContain("Claude");
    expect(names).toContain("ChatGPT");
    expect(names).toContain("Google");
    expect(names.join(" ")).not.toMatch(/CLI/);
  });
});

describe("백엔드마다 다른 Figma 경로가 안내에 반영된다", () => {
  const textOf = (id: string) =>
    firstRunSteps(id)
      .map((s) => `${s.title} ${s.body} ${s.command ?? ""}`)
      .join(" ");

  it("codex는 mcp add 명령을 준다", () => {
    expect(textOf("codex")).toMatch(/codex mcp add figma --url https:\/\/mcp\.figma\.com\/mcp/);
  });

  it("antigravity는 토큰을 안내하고 MCP 등록을 시키지 않는다", () => {
    // agy에는 Figma MCP를 붙일 방법이 없다(실측) — 등록 명령을 안내하면
    // 팀원이 존재하지 않는 설정을 찾아 헤맨다.
    const text = textOf("antigravity");
    expect(text).toMatch(/Personal access tokens/);
    expect(text).not.toMatch(/mcp add/i);
  });

  it("claude-code는 커넥터 연결을 안내한다", () => {
    expect(textOf("claude-code")).toMatch(/커넥터/);
  });

  it("mock은 구독을 요구하지 않는다고 분명히 말한다", () => {
    expect(textOf("mock")).toMatch(/구독도 로그인도 필요 없습니다/);
  });
});
