/**
 * Play autocomplete / suggest — keyless keyword discovery. We pin the request
 * builder (rpcid + seed), the content-based parser (plausible suggestions out of
 * the JSON-encoded inner payload, deduped), all degrade paths, and the honest
 * discovery finding (zero volume, silence on empty).
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSuggestRequest,
  parseSuggestResponse,
  playSuggestFinding,
  playSuggestSource,
} from "./playSuggest.js";
import type { FetchLike } from "./googleAuth.js";

describe("buildSuggestRequest", () => {
  it("targets the IJ4APc rpc and carries the seed + country", () => {
    const { url, body } = buildSuggestRequest({ term: "yoga", country: "us" });
    expect(url).toContain("rpcids=IJ4APc");
    expect(url).toContain("gl=us");
    expect(decodeURIComponent(body)).toContain("yoga");
  });
});

describe("parseSuggestResponse — content-based", () => {
  function envelope(suggestions: string[]): string {
    const inner = JSON.stringify([suggestions.map((s) => [s, null, []])]);
    return `)]}'\n\n` + JSON.stringify([[["IJ4APc", inner, null, "generic"]]]);
  }
  it("extracts suggestion phrases in order, deduped", () => {
    const out = parseSuggestResponse(envelope(["yoga", "yoga for beginners", "yoga", "yoga poses"]));
    expect(out).toEqual(["yoga", "yoga for beginners", "yoga poses"]);
  });
  it("rejects package ids, urls, and markup; caps at the limit", () => {
    const out = parseSuggestResponse(envelope(["com.foo.bar", "https://x.y", "real term", "another term"]), 1);
    expect(out).toEqual(["real term"]);
  });
  it("returns [] on garbage", () => {
    expect(parseSuggestResponse("not json")).toEqual([]);
    expect(parseSuggestResponse("")).toEqual([]);
  });
});

describe("playSuggestFinding", () => {
  it("lists discovered terms as a zero-volume discovery context finding", () => {
    const f = playSuggestFinding("yoga", ["yoga for beginners", "yoga poses"])[0]!;
    expect(f.id).toBe("play_suggest_discovery");
    expect(f.context).toBe(true);
    expect(f.evidence).toContain("yoga for beginners");
    expect(f.detail).toMatch(/no search volume|not a number/i);
  });
  it("empty suggestions → nothing (honest silence)", () => {
    expect(playSuggestFinding("yoga", [])).toEqual([]);
  });
});

describe("playSuggestSource — degrade-safe", () => {
  const okFetch = (bodyText: string): FetchLike =>
    vi.fn(async () => ({ ok: true, status: 200, text: async () => bodyText })) as unknown as FetchLike;
  it("returns parsed suggestions on a good response", async () => {
    const inner = JSON.stringify([[["yoga mat"], ["yoga app"]]]);
    const body = `)]}'\n` + JSON.stringify([[["IJ4APc", inner, null, "generic"]]]);
    const src = playSuggestSource(okFetch(body));
    expect(await src({ term: "yoga", country: "us" })).toContain("yoga mat");
  });
  it("a blank seed → [] without a fetch", async () => {
    const fetchLike = vi.fn() as unknown as FetchLike;
    expect(await playSuggestSource(fetchLike)({ term: "  ", country: "us" })).toEqual([]);
    expect(fetchLike).not.toHaveBeenCalled();
  });
  it("a non-OK status → []", async () => {
    const src = playSuggestSource(vi.fn(async () => ({ ok: false, status: 429, text: async () => "" })) as unknown as FetchLike);
    expect(await src({ term: "yoga", country: "us" })).toEqual([]);
  });
  it("a throwing fetch → [] (never throws)", async () => {
    const src = playSuggestSource(vi.fn(async () => { throw new Error("egress blocked"); }) as unknown as FetchLike);
    expect(await src({ term: "yoga", country: "us" })).toEqual([]);
  });
});
