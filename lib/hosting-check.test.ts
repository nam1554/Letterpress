import { describe, expect, it } from "vitest";
import {
  checkHostedUrls,
  hostedEntries,
  uploadKeyFor,
  type ProbeFetcher,
} from "./hosting-check";

const IIIF = "https://cdn.example.com/iiif/3/{folder}__{file}/full/max/0/default.{ext}";
const STATIC = "https://cdn.example.com/assets/{folder}/{file}";

describe("uploadKeyFor", () => {
  it("derives the MinIO object key when the template uses the {folder}__{file} rule", () => {
    expect(uploadKeyFor(IIIF, "hero.jpg", "edm_20260807")).toBe("edm_20260807__hero.jpg");
  });

  it("returns null for templates without the __ rule — 키를 지어내지 않는다", () => {
    expect(uploadKeyFor(STATIC, "hero.jpg", "edm")).toBeNull();
    expect(uploadKeyFor("https://cdn.example.com/{file}", "hero.jpg", "")).toBeNull();
  });
});

describe("hostedEntries", () => {
  it("maps files to the same URLs the hosted/ substitution produced", () => {
    const entries = hostedEntries(["hero.jpg", "logo.png"], IIIF, "camp");
    expect(entries).toEqual([
      {
        file: "hero.jpg",
        url: "https://cdn.example.com/iiif/3/camp__hero.jpg/full/max/0/default.jpg",
        uploadKey: "camp__hero.jpg",
      },
      {
        file: "logo.png",
        url: "https://cdn.example.com/iiif/3/camp__logo.png/full/max/0/default.png",
        uploadKey: "camp__logo.png",
      },
    ]);
  });
});

function fetcherOf(map: Record<string, number | "hang">): ProbeFetcher {
  return (url, _method, signal) =>
    new Promise((resolve, reject) => {
      const answer = map[url];
      if (answer === "hang") {
        // 타임아웃(신호 중단)까지 응답하지 않는 서버.
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        return;
      }
      if (answer === undefined) reject(new TypeError("fetch failed"));
      else resolve({ status: answer });
    });
}

describe("checkHostedUrls", () => {
  const entries = hostedEntries(["a.png", "b.png", "c.png"], IIIF, "f");
  const urlOf = (file: string) =>
    `https://cdn.example.com/iiif/3/f__${file}/full/max/0/default.png`;

  it("classifies live / missing / unreachable", async () => {
    const summary = await checkHostedUrls(
      entries,
      fetcherOf({ [urlOf("a.png")]: 200, [urlOf("b.png")]: 404 }),
      { timeoutMs: 50 },
    );
    expect(summary.live).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.unreachable).toBe(1);
    expect(summary.allUnreachable).toBe(false);
    expect(summary.checks.map((c) => c.state)).toEqual(["live", "missing", "unreachable"]);
    expect(summary.checks[1].status).toBe(404);
  });

  it("reports allUnreachable so the UI can say '망 문제' instead of '미업로드'", async () => {
    const summary = await checkHostedUrls(entries, fetcherOf({}), { timeoutMs: 50 });
    expect(summary.allUnreachable).toBe(true);
    expect(summary.unreachable).toBe(3);
  });

  it("treats a hanging server as unreachable via the timeout", async () => {
    const summary = await checkHostedUrls(
      hostedEntries(["a.png"], IIIF, "f"),
      fetcherOf({ [urlOf("a.png")]: "hang" }),
      { timeoutMs: 30 },
    );
    expect(summary.checks[0].state).toBe("unreachable");
  });

  it("falls back to GET when HEAD is not allowed", async () => {
    const calls: string[] = [];
    const fetcher: ProbeFetcher = (url, method) => {
      calls.push(method);
      if (method === "HEAD") return Promise.resolve({ status: 405 });
      return Promise.resolve({ status: 200 });
    };
    const summary = await checkHostedUrls(hostedEntries(["a.png"], IIIF, "f"), fetcher, {
      timeoutMs: 50,
    });
    expect(calls).toEqual(["HEAD", "GET"]);
    expect(summary.checks[0].state).toBe("live");
  });

  it("caps concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetcher: ProbeFetcher = () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve({ status: 200 });
        }, 5),
      );
    };
    const many = hostedEntries(
      Array.from({ length: 8 }, (_, i) => `f${i}.png`),
      IIIF,
      "f",
    );
    await checkHostedUrls(many, fetcher, { timeoutMs: 100, concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
