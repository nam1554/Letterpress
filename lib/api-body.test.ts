import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readBody } from "./api-body";

const post = (body: string) =>
  new Request("http://localhost/api", { method: "POST", body });

const schema = z.object({
  name: z.string({ error: "이름이 필요합니다." }).min(2, "이름이 너무 짧습니다."),
});

async function errorOf(body: string): Promise<string> {
  const r = await readBody(post(body), schema);
  if (r.ok) throw new Error("expected failure");
  return (await r.res.json()).error;
}

describe("readBody", () => {
  it("유효한 바디는 파싱해 돌려준다", async () => {
    const r = await readBody(post(JSON.stringify({ name: "letterpress" })), schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("letterpress");
  });

  it("JSON이 아니면 한국어 400", async () => {
    expect(await errorOf("not json")).toBe("잘못된 JSON 요청입니다.");
  });

  it("필드 이슈는 '필드: 스키마 문구' 형태", async () => {
    expect(await errorOf(JSON.stringify({ name: "x" }))).toBe("name: 이름이 너무 짧습니다.");
    expect(await errorOf(JSON.stringify({}))).toBe("name: 이름이 필요합니다.");
  });

  it("최상위 타입 위반도 한국어다 — zod 기본 영어가 새면 안 된다", async () => {
    // 실측(2026-08-08): "Invalid input: expected object, received null"이
    // 그대로 사용자에게 나갔다. 이 앱의 사용자 대면 문구는 전부 한국어다.
    for (const body of ["null", "[]", '"문자열"', "42"]) {
      const message = await errorOf(body);
      expect(message, body).toBe("요청 형식이 올바르지 않습니다.");
    }
  });

  it("스키마 문구가 필드명을 이미 담고 있으면 접두를 붙이지 않는다", async () => {
    // 실측: "figmaUrl: figmaUrl이 필요합니다."처럼 이름이 두 번 나왔다.
    const named = z.object({ figmaUrl: z.string({ error: "figmaUrl이 필요합니다." }) });
    const r = await readBody(post("{}"), named);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((await r.res.json()).error).toBe("figmaUrl이 필요합니다.");
  });

  it("zod 기본을 덮되 위반 '이유'는 남긴다 — min/max가 구분돼야 한다", async () => {
    // 실측 퇴행: 둘 다 "ids: 값 형식이 올바르지 않습니다."로 뭉개졌다.
    const ids = z.object({ ids: z.array(z.string()).min(1).max(200) });
    const small = await readBody(post(JSON.stringify({ ids: [] })), ids);
    const big = await readBody(post(JSON.stringify({ ids: new Array(201).fill("x") })), ids);
    expect(small.ok || big.ok).toBe(false);
    if (!small.ok && !big.ok) {
      const a = (await small.res.json()).error;
      const b = (await big.res.json()).error;
      expect(a).toBe("ids: 최소 1개 이상이어야 합니다.");
      expect(b).toBe("ids: 최대 200개 이하여야 합니다.");
      expect(a).not.toBe(b);
    }
  });

  it("문자열 길이 위반은 '자' 단위로 말한다", async () => {
    const s = z.object({ name: z.string().min(2) });
    const r = await readBody(post(JSON.stringify({ name: "x" })), s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((await r.res.json()).error).toBe("name: 최소 2자 이상이어야 합니다.");
  });

  it("문구 없는 필드의 zod 기본 영어도 덮되 필드명은 남긴다", async () => {
    // 실측: `provider: z.string().optional()`처럼 error 문구가 없는 필드는
    // "provider: Invalid input: expected string, received number"가 그대로 나갔다.
    const loose = z.object({ figmaUrl: z.string({ error: "figmaUrl이 필요합니다." }), provider: z.string().optional() });
    const r = await readBody(post(JSON.stringify({ figmaUrl: "x", provider: 123 })), loose);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((await r.res.json()).error).toBe("provider: 값 형식이 올바르지 않습니다.");
    }
  });

  it("정상 객체가 union 갈래를 모두 어겨도 'JSON 객체여야' 라고 오도하지 않는다", async () => {
    // artifact 라우트의 실제 스키마 모양. 실측: path 없는 invalid_union 이슈라
    // 최상위 분기를 타지만, 사용자는 이미 객체를 보냈다 (리뷰에서 잡힌 회귀).
    const union = z.union([
      z.object({ file: z.string().min(1), html: z.string().min(1) }),
      z.object({ file: z.string().min(1), restore: z.literal(true) }),
    ]);
    const r = await readBody(post(JSON.stringify({ file: "x.html" })), union);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const message = (await r.res.json()).error;
      expect(message).toBe("요청 형식이 올바르지 않습니다.");
      expect(message).not.toMatch(/객체/);
    }
  });
});
