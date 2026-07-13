/**
 * The concrete keyless Play chart source (batchexecute). We can't exercise the
 * live RPC here, so we pin the two things we CAN: the request builder (rpcid +
 * collection mapping + category) and the content-based response parser (finds
 * package ids in order — including inside the JSON-encoded inner payload — and
 * degrades to [] on anything it can't parse). The source itself is degrade-safe.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildChartRequest,
  parsePlayChartResponse,
  playChartSource,
} from "./playChartSource.js";
import type { FetchLike } from "./googleAuth.js";

describe("buildChartRequest", () => {
  it("targets the vyAe2 rpc and maps the collection to its server value", () => {
    const { url, body } = buildChartRequest({ collection: "TOP_FREE", category: "WEATHER", country: "us" });
    expect(url).toContain("rpcids=vyAe2");
    expect(url).toContain("gl=us");
    expect(decodeURIComponent(body)).toContain("topselling_free");
    expect(decodeURIComponent(body)).toContain("WEATHER");
  });
  it("maps GROSSING → topgrossing", () => {
    const { body } = buildChartRequest({ collection: "GROSSING", category: "GAME", country: "jp" });
    expect(decodeURIComponent(body)).toContain("topgrossing");
  });
});

describe("parsePlayChartResponse — content-based, drift-tolerant", () => {
  // A realistic-ish batchexecute envelope: anti-hijack prefix + outer array whose
  // rpc RESULT is a JSON-ENCODED STRING containing the ordered app rows.
  function envelope(pkgs: string[]): string {
    const inner = JSON.stringify([[pkgs.map((p) => [[p], ["Some App"], null])]]);
    return `)]}'\n\n` + JSON.stringify([[["vyAe2", inner, null, "generic"]]]);
  }

  it("extracts the package ids IN ORDER, including from the stringified inner payload", () => {
    const out = parsePlayChartResponse(envelope(["com.a.app", "com.me.app", "com.b.app"]));
    expect(out).toEqual(["com.a.app", "com.me.app", "com.b.app"]);
  });
  it("dedups and caps at the limit", () => {
    const out = parsePlayChartResponse(envelope(["com.a.app", "com.a.app", "com.b.app"]), 1);
    expect(out).toEqual(["com.a.app"]);
  });
  it("ignores non-package strings and returns [] on garbage", () => {
    expect(parsePlayChartResponse(")]}'\n\n[[[\"vyAe2\",\"[[[[\\\"just a title\\\"]]]]\"]]]")).toEqual([]);
    expect(parsePlayChartResponse("not json at all")).toEqual([]);
    expect(parsePlayChartResponse("")).toEqual([]);
  });
});

describe("playChartSource — degrade-safe", () => {
  const okFetch = (bodyText: string): FetchLike =>
    vi.fn(async () => ({ ok: true, status: 200, text: async () => bodyText })) as unknown as FetchLike;

  it("returns the parsed ordered ids on a good response", async () => {
    const inner = JSON.stringify([[[["com.x.app"], null], [["com.me.app"], null]]]);
    const body = `)]}'\n` + JSON.stringify([[["vyAe2", inner, null, "generic"]]]);
    const src = playChartSource(okFetch(body));
    const ids = await src({ collection: "TOP_FREE", category: "WEATHER", country: "us" });
    expect(ids).toContain("com.me.app");
  });
  it("a non-OK status → [] (UNKNOWN downstream)", async () => {
    const src = playChartSource(vi.fn(async () => ({ ok: false, status: 429, text: async () => "" })) as unknown as FetchLike);
    expect(await src({ collection: "TOP_FREE", category: "WEATHER", country: "us" })).toEqual([]);
  });
  it("a throwing fetch → [] (never throws)", async () => {
    const src = playChartSource(vi.fn(async () => {
      throw new Error("egress blocked");
    }) as unknown as FetchLike);
    expect(await src({ collection: "TOP_FREE", category: "WEATHER", country: "us" })).toEqual([]);
  });
});
