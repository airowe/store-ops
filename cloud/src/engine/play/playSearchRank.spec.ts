/**
 * Play keyword SEARCH rank — pure computation + finding + parser. Honesty
 * invariants: measured index or an honest "not ranking" or `null` UNKNOWN (never
 * a fabricated position); a coarse bucket leads because Play search is
 * personalized; the source degrades to `[]` on any failure.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchPlaySearchRank,
  playSearchRankFinding,
  playSearchRankFromEntries,
  searchBucket,
  type PlaySearchSource,
} from "./playSearchRank.js";
import { parsePlaySearchResults, playSearchSource } from "./playSearchSource.js";
import type { PlayPageSource } from "./playWebSource.js";

describe("searchBucket", () => {
  it("maps positions to coarse buckets", () => {
    expect(searchBucket(1)).toBe("top3");
    expect(searchBucket(3)).toBe("top3");
    expect(searchBucket(9)).toBe("top10");
    expect(searchBucket(15)).toBe("top20");
    expect(searchBucket(42)).toBe("top50");
    expect(searchBucket(51)).toBe("beyond50");
  });
});

describe("playSearchRankFromEntries", () => {
  it("1-based position + bucket when present", () => {
    const r = playSearchRankFromEntries(["com.a", "com.me", "com.b"], "com.me", { term: "yoga", country: "us" });
    expect(r).toMatchObject({ ranked: true, position: 2, bucket: "top3", outOf: 3 });
  });
  it("ranked:false when absent (never a fabricated number)", () => {
    const r = playSearchRankFromEntries(["com.a", "com.b"], "com.me", { term: "yoga", country: "us" });
    expect(r).toMatchObject({ ranked: false, outOf: 2 });
  });
});

describe("fetchPlaySearchRank — degrade-safe", () => {
  const src = (ids: string[]): PlaySearchSource => vi.fn(async () => ids);
  it("returns a ranked position on a good read", async () => {
    const r = await fetchPlaySearchRank(src(["com.x", "com.me"]), { packageName: "com.me", term: "yoga" });
    expect(r).toMatchObject({ ranked: true, position: 2 });
  });
  it("empty results → null (UNKNOWN, not 'not ranking')", async () => {
    expect(await fetchPlaySearchRank(src([]), { packageName: "com.me", term: "yoga" })).toBeNull();
  });
  it("a throwing source → null, never throws", async () => {
    const bad: PlaySearchSource = vi.fn(async () => {
      throw new Error("429");
    });
    expect(await fetchPlaySearchRank(bad, { packageName: "com.me", term: "yoga" })).toBeNull();
  });
  it("a blank term → null", async () => {
    expect(await fetchPlaySearchRank(src(["com.me"]), { packageName: "com.me", term: "  " })).toBeNull();
  });
});

describe("playSearchRankFinding", () => {
  it("leads with the bucket, keeps the exact position as evidence", () => {
    const f = playSearchRankFinding({ term: "yoga", country: "us", outOf: 50, ranked: true, position: 2, bucket: "top3" })[0]!;
    expect(f.id).toBe("play_search_rank");
    expect(f.title).toMatch(/top 3/);
    expect(f.evidence).toMatch(/#2 of 50/);
    expect(f.context).toBe(true);
  });
  it("not ranking → an honest measured 'not in top N' fact", () => {
    const f = playSearchRankFinding({ term: "yoga", country: "us", outOf: 50, ranked: false })[0]!;
    expect(f.id).toBe("play_search_not_ranking");
  });
  it("UNKNOWN (null) contributes nothing", () => {
    expect(playSearchRankFinding(null)).toEqual([]);
  });
});

describe("parsePlaySearchResults — content-based, ordered, deduped", () => {
  it("extracts package ids in document order and dedups (first position wins)", () => {
    const html = `
      <a href="/store/apps/details?id=com.first.app">F</a>
      <a href="/store/apps/details?id=com.second.app&hl=en">S</a>
      <a href="/store/apps/details?id=com.first.app">dup</a>
      <a href="/store/apps/details?id=com.third.app">T</a>`;
    expect(parsePlaySearchResults(html)).toEqual(["com.first.app", "com.second.app", "com.third.app"]);
  });
  it("ignores non-package ids and caps at the limit", () => {
    const html = `<a href="/store/apps/details?id=notapackage">x</a>
      <a href="/store/apps/details?id=com.a.b">a</a>
      <a href="/store/apps/details?id=com.c.d">c</a>`;
    expect(parsePlaySearchResults(html, 1)).toEqual(["com.a.b"]);
  });
  it("returns [] on garbage", () => {
    expect(parsePlaySearchResults("no links here")).toEqual([]);
    expect(parsePlaySearchResults("")).toEqual([]);
  });
});

describe("playSearchSource — degrade-safe over the page source", () => {
  const page = (html: string): PlayPageSource => ({
    detail: vi.fn(async () => ""),
    search: vi.fn(async () => html),
  });
  it("parses the fetched search HTML into ordered ids", async () => {
    const src = playSearchSource(page(`<a href="/store/apps/details?id=com.me.app">me</a>`));
    expect(await src({ term: "yoga", country: "us" })).toEqual(["com.me.app"]);
  });
  it("a throwing page source → [] (never throws)", async () => {
    const src = playSearchSource({ detail: vi.fn(async () => ""), search: vi.fn(async () => { throw new Error("403"); }) });
    expect(await src({ term: "yoga", country: "us" })).toEqual([]);
  });
});
