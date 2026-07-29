import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson, sendJson } from "./request";

afterEach(() => vi.unstubAllGlobals());

const stub = (impl: () => Promise<Response> | never) => vi.stubGlobal("fetch", impl);

describe("requestJson", () => {
  it("returns the parsed body on success", async () => {
    stub(async () => Response.json({ job: { id: "abc" } }, { status: 201 }));
    const r = await requestJson<{ job: { id: string } }>("/api/jobs");
    expect(r).toEqual({ ok: true, data: { job: { id: "abc" } } });
  });

  it("surfaces the API error message", async () => {
    stub(async () => Response.json({ error: "실패한 작업만 이어서 실행할 수 있습니다." }, { status: 409 }));
    const r = await requestJson("/api/jobs/x/resume", { method: "POST" });
    expect(r).toEqual({ ok: false, error: "실패한 작업만 이어서 실행할 수 있습니다." });
  });

  it("reports a message when the server answers with a non-JSON error page", async () => {
    // 라우트에서 처리되지 않은 예외 → Next의 HTML 500. 여기서 res.json()이
    // 던지면 호출부의 클릭이 통째로 삼켜진다.
    stub(async () => new Response("<html>Internal Server Error</html>", { status: 500 }));
    const r = await requestJson("/api/jobs", { method: "POST" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("500");
  });

  it("reports a message when the server cannot be reached", async () => {
    stub(() => {
      throw new TypeError("Failed to fetch");
    });
    const r = await requestJson("/api/jobs", { method: "POST" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("서버에 연결할 수 없습니다");
  });

  it("treats an empty 200 body as success", async () => {
    stub(async () => new Response(null, { status: 204 }));
    expect((await requestJson("/api/x")).ok).toBe(true);
  });
});

describe("sendJson", () => {
  it("serializes the body and sets the content type", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return Response.json({ ok: true });
    });

    await sendJson("/api/jobs/abc/edit", "POST", { instruction: "헤드라인 변경" });
    const [url, init] = calls[0];
    expect(url).toBe("/api/jobs/abc/edit");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ instruction: "헤드라인 변경" }));
  });

  it("omits the body entirely when there is none", async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      calls.push(init);
      return Response.json({ ok: true });
    });

    await sendJson("/api/jobs/abc/cancel", "POST");
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers).toBeUndefined();
  });
});
