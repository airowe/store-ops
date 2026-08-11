import { describe, expect, it, vi } from "vitest";
import { MAX_RETRIES } from "./constants.js";
import {
  NEIGHBOUR_COUNT,
  fetchNeighbourIcons,
  neighbourIconsFromResults,
  neighbourIdsFromChart,
} from "./iconNeighbours.js";

const art = (id: string) => `https://cdn.example/${id}/512.png`;

const result = (id: number, over: Record<string, unknown> = {}) => ({
  trackId: id,
  artworkUrl512: art(String(id)),
  ...over,
});

/** A fetch that returns one iTunes-shaped payload. */
const lookupFetch = (body: unknown) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as never;

describe("neighbourIdsFromChart", () => {
  it("takes the top N chart ids", () => {
    const entries = Array.from({ length: 30 }, (_, i) => `${i}`);
    expect(neighbourIdsFromChart(entries, "mine", 10)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${i}`),
    );
  });

  it("excludes our own app wherever it sits in the chart", () => {
    const entries = ["a", "b", "mine", "c", "d"];
    expect(neighbourIdsFromChart(entries, "mine", 10)).toEqual(["a", "b", "c", "d"]);
  });

  it("still yields neighbours when our app is not in the chart at all", () => {
    // an unranked app must still get a comparison set
    expect(neighbourIdsFromChart(["a", "b", "c"], "mine", 10)).toEqual(["a", "b", "c"]);
  });

  it("dedupes repeated ids so the lookup budget isn't spent twice on one app", () => {
    expect(neighbourIdsFromChart(["a", "b", "a", "c", "b"], "mine", 10)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns fewer than N when the chart is short, rather than padding", () => {
    expect(neighbourIdsFromChart(["a", "b"], "mine", 10)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty chart", () => {
    expect(neighbourIdsFromChart([], "mine")).toEqual([]);
  });

  it("defaults to NEIGHBOUR_COUNT", () => {
    const entries = Array.from({ length: 50 }, (_, i) => `${i}`);
    expect(neighbourIdsFromChart(entries, "mine")).toHaveLength(NEIGHBOUR_COUNT);
  });
});

describe("neighbourIconsFromResults", () => {
  it("keys each result by its OWN trackId, not by position", () => {
    // Verified against the live endpoint: Apple returns its own order, not ours.
    const results = [result(300), result(100), result(200)];
    const out = neighbourIconsFromResults(results, ["100", "200", "300"]);
    expect(out).toEqual([
      { appId: "100", artworkUrl: art("300").replace("300", "100") },
      { appId: "200", artworkUrl: art("200") },
      { appId: "300", artworkUrl: art("300") },
    ]);
  });

  it("returns the set in OUR requested order, not the response order", () => {
    const results = [result(3), result(1), result(2)];
    const out = neighbourIconsFromResults(results, ["1", "2", "3"]);
    expect(out.map((n) => n.appId)).toEqual(["1", "2", "3"]);
  });

  it("omits an id Apple did not return (unknown ids are silently dropped)", () => {
    const out = neighbourIconsFromResults([result(1)], ["1", "999"]);
    expect(out).toEqual([{ appId: "1", artworkUrl: art("1") }]);
  });

  it("falls back through the artwork sizes", () => {
    const only100 = { trackId: 1, artworkUrl100: "a100.png" };
    expect(neighbourIconsFromResults([only100], ["1"])[0]!.artworkUrl).toBe("a100.png");
    const only60 = { trackId: 2, artworkUrl60: "a60.png" };
    expect(neighbourIconsFromResults([only60], ["2"])[0]!.artworkUrl).toBe("a60.png");
  });

  it("drops a result with no artwork rather than carrying a blank url", () => {
    const noArt = { trackId: 1, trackName: "No Art" };
    expect(neighbourIconsFromResults([noArt], ["1"])).toEqual([]);
  });

  it("never emits an entry with an empty artwork url", () => {
    // The invariant, independent of WHICH guard catches it: an unreadable icon
    // must not reach the set, because everything downstream assumes a fetchable
    // url. Empty-string artwork fields are the shape a lenient parse can produce.
    const blanks = [
      { trackId: 1, artworkUrl512: "" },
      { trackId: 2, artworkUrl512: "", artworkUrl100: "" },
      { trackId: 3 },
    ];
    const out = neighbourIconsFromResults(blanks, ["1", "2", "3"]);
    expect(out).toEqual([]);
    expect(out.every((n) => n.artworkUrl.length > 0)).toBe(true);
  });

  it("drops a result with no usable trackId", () => {
    const noId = { artworkUrl512: "x.png" };
    const strId = { trackId: "1", artworkUrl512: "y.png" };
    expect(neighbourIconsFromResults([noId, strId], ["1"])).toEqual([]);
  });

  it("ignores junk entries without throwing", () => {
    const out = neighbourIconsFromResults([null, undefined, "nope", 42, result(1)], ["1"]);
    expect(out).toEqual([{ appId: "1", artworkUrl: art("1") }]);
  });
});

describe("fetchNeighbourIcons", () => {
  it("asks for the whole set in ONE request, comma-separated", async () => {
    const fetchFn = lookupFetch({ resultCount: 2, results: [result(1), result(2)] });
    const out = await fetchNeighbourIcons(fetchFn, ["1", "2"]);
    expect(out).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(String(url)).toContain("id=1%2C2");
  });

  it("dedupes ids before spending the request on a repeat", async () => {
    const fetchFn = lookupFetch({ resultCount: 1, results: [result(1)] });
    await fetchNeighbourIcons(fetchFn, ["1", "1", "1"]);
    const url = String((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(url).toContain("id=1&");
    expect(url).not.toContain("1%2C1");
  });

  it("never calls the network for an empty id set", async () => {
    const fetchFn = lookupFetch({ results: [] });
    expect(await fetchNeighbourIcons(fetchFn, [])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns an empty set on a non-retryable HTTP failure, never a partial one", async () => {
    // 404 is outside RETRY_STATUS, so this exercises the failure path directly.
    const notFound = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "",
    })) as never;
    expect(await fetchNeighbourIcons(notFound, ["1", "2"])).toEqual([]);
  });

  it(
    "returns an empty set once retries are exhausted on a thrown fetch",
    async () => {
      // A raw throw is retried with exponential backoff (itunes.ts fetchJson),
      // so this deliberately outlives the default 5s timeout. It is kept because
      // the retry path is the one a real network blip takes.
      const boom = vi.fn(async () => {
        throw new Error("network");
      }) as never;
      expect(await fetchNeighbourIcons(boom, ["1", "2"])).toEqual([]);
      // the initial attempt plus MAX_RETRIES retries, read from the constant so
      // this doesn't silently drift if the retry policy changes
      expect(boom).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    },
    20_000,
  );

  it("returns an empty set when Apple returns no results", async () => {
    const fetchFn = lookupFetch({ resultCount: 0, results: [] });
    expect(await fetchNeighbourIcons(fetchFn, ["1"])).toEqual([]);
  });

  it("passes the country through", async () => {
    const fetchFn = lookupFetch({ results: [result(1)] });
    await fetchNeighbourIcons(fetchFn, ["1"], "gb");
    const url = String((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(url).toContain("country=gb");
  });
});
