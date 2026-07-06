import { describe, expect, it } from "vitest";
import { keywordPopularity } from "./asaClient.js";
import type { FetchLike } from "./asaAuth.js";

function fetchReturning(status: number, body: string, capture?: (init: { headers?: Record<string, string>; body?: string }) => void): FetchLike {
  return async (_url, init) => {
    capture?.(init);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

describe("keywordPopularity — real ASA popularity, degrade-safe, never fabricates", () => {
  it("parses the documented { data: [...] } envelope, keyed lower-case", async () => {
    const fn = fetchReturning(
      200,
      JSON.stringify({ data: [
        { keyword: "Meal Planner", searchPopularity: 62 },
        { keyword: "yoga", searchPopularity: 40 },
      ] }),
    );
    const out = await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: ["meal planner", "yoga"] });
    expect(out.get("meal planner")).toEqual({ keyword: "Meal Planner", popularity: 62, source: "asa" });
    expect(out.get("yoga")?.popularity).toBe(40);
  });

  it("sends the org context header and the keywords body", async () => {
    let seen: { headers?: Record<string, string>; body?: string } = {};
    const fn = fetchReturning(200, JSON.stringify({ data: [] }), (init) => (seen = init));
    await keywordPopularity(fn, { accessToken: "tok", orgId: "77", terms: ["a", "b"] });
    expect(seen.headers?.["Authorization"]).toBe("Bearer tok");
    expect(seen.headers?.["X-AP-Context"]).toBe("orgId=77");
    expect(JSON.parse(seen.body!)).toEqual({ keywords: ["a", "b"] });
  });

  it("accepts alternate field names (text / popularity) and a bare array", async () => {
    const fn = fetchReturning(200, JSON.stringify([{ text: "budget", popularity: "55" }]));
    const out = await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: ["budget"] });
    expect(out.get("budget")?.popularity).toBe(55);
  });

  it("dedupes and skips empty input terms", async () => {
    let seen: { body?: string } = {};
    const fn = fetchReturning(200, JSON.stringify({ data: [] }), (init) => (seen = init));
    await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: ["A", "a", " ", "b"] });
    expect(JSON.parse(seen.body!).keywords).toEqual(["A", "b"]);
  });

  it("empty terms → no request, empty map", async () => {
    let called = false;
    const fn: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const out = await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: [] });
    expect(called).toBe(false);
    expect(out.size).toBe(0);
  });

  it("non-2xx → empty map (never throws, never fabricates)", async () => {
    const out = await keywordPopularity(fetchReturning(429, "rate limited"), { accessToken: "t", orgId: "9", terms: ["x"] });
    expect(out.size).toBe(0);
  });

  it("non-JSON body → empty map", async () => {
    const out = await keywordPopularity(fetchReturning(200, "<html>"), { accessToken: "t", orgId: "9", terms: ["x"] });
    expect(out.size).toBe(0);
  });

  it("unexpected shape / missing score → term dropped, not guessed", async () => {
    const fn = fetchReturning(200, JSON.stringify({ data: [{ keyword: "x" }, { keyword: "y", searchPopularity: 30 }] }));
    const out = await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: ["x", "y"] });
    expect(out.has("x")).toBe(false); // no score → dropped
    expect(out.get("y")?.popularity).toBe(30);
  });

  it("transport throw → empty map (honest fallback)", async () => {
    const fn: FetchLike = async () => {
      throw new Error("network down");
    };
    const out = await keywordPopularity(fn, { accessToken: "t", orgId: "9", terms: ["x"] });
    expect(out.size).toBe(0);
  });
});
