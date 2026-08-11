/**
 * The icon comparison chain (#455) — the wiring that makes four merged modules
 * produce a finding.
 *
 * The failure this guards against is specific and has already happened twice in
 * this codebase: a module that exists, is tested, and is never called. These
 * tests drive the chain end to end with a fake analyzer and a stubbed feed, so
 * "the pieces work" and "the feature works" are different assertions.
 */
import { describe, expect, it, vi } from "vitest";
import { MIN_NEIGHBOURS, type IconComposition } from "./iconDistinctiveness.js";
import { iconComparisonFindings, readIconSet } from "./iconComparison.js";

const CENTRED: IconComposition = { layout: "single_centred_shape", hasText: false };
const OTHER: IconComposition = { layout: "other", hasText: false };

const MY_ID = "500";
const art = (id: string) => `https://cdn.example/${id}.png`;

/** A lookup fetch returning artwork for whichever ids were requested. */
const lookupFetch = (ids: string[]) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () =>
      JSON.stringify({
        resultCount: ids.length,
        results: ids.map((id) => ({ trackId: Number(id), artworkUrl512: art(id) })),
      }),
  })) as never;

/** ten neighbours, all conforming to one centred shape. */
const TEN = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** A batch analyzer that maps each url to a composition by lookup table. */
const batchOf = (table: Record<string, IconComposition | null>) =>
  vi.fn(async (urls: string[]) => urls.map((u) => table[u] ?? null));

/** Every neighbour centred; ours set by the caller. */
const conformingTable = (mine: IconComposition | null) => ({
  [art(MY_ID)]: mine,
  ...Object.fromEntries(TEN.map((id) => [art(id), CENTRED])),
});

const input = (over: Partial<Parameters<typeof iconComparisonFindings>[2]> = {}) => ({
  appId: MY_ID,
  artworkUrl: art(MY_ID),
  chartEntries: [...TEN],
  country: "us",
  ...over,
});

describe("readIconSet", () => {
  it("keys each composition to its own app, in order", async () => {
    const batch = batchOf({ "a.png": CENTRED, "b.png": OTHER });
    const out = await readIconSet(batch, [
      { appId: "a", artworkUrl: "a.png" },
      { appId: "b", artworkUrl: "b.png" },
    ]);
    expect(out).toEqual([
      { appId: "a", composition: CENTRED },
      { appId: "b", composition: OTHER },
    ]);
  });

  it("DROPS an icon the batch could not read rather than defaulting it", async () => {
    const batch = batchOf({ "a.png": CENTRED, "b.png": null });
    const out = await readIconSet(batch, [
      { appId: "a", artworkUrl: "a.png" },
      { appId: "b", artworkUrl: "b.png" },
    ]);
    expect(out).toEqual([{ appId: "a", composition: CENTRED }]);
  });

  it("spends nothing on an empty target list", async () => {
    const batch = batchOf({});
    expect(await readIconSet(batch, [])).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("iconComparisonFindings — the chain produces a finding", () => {
  it("emits icon_stands_apart when ours differs from a clear convention", async () => {
    const out = await iconComparisonFindings(
      lookupFetch(TEN),
      batchOf(conformingTable(OTHER)),
      input(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("icon_stands_apart");
    expect(out[0]!.evidence).toContain(`of ${TEN.length}`);
  });

  it("emits icon_conforms_to_category when ours matches the convention", async () => {
    const out = await iconComparisonFindings(
      lookupFetch(TEN),
      batchOf(conformingTable(CENTRED)),
      input(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("icon_conforms_to_category");
  });

  it("measures OUR icon first, so a tight budget never drops the one we need", async () => {
    const seen: string[][] = [];
    const batch = vi.fn(async (urls: string[]) => {
      seen.push(urls);
      return urls.map((u) => conformingTable(OTHER)[u] ?? null);
    });
    await iconComparisonFindings(lookupFetch(TEN), batch, input());
    expect(seen[0]![0]).toBe(art(MY_ID));
  });

  it("reads every icon in ONE batch, so they share one budget", async () => {
    const batch = batchOf(conformingTable(OTHER));
    await iconComparisonFindings(lookupFetch(TEN), batch, input());
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("excludes our own app from the neighbour set even when we are in the chart", async () => {
    const withMe = [MY_ID, ...TEN];
    const batch = batchOf(conformingTable(OTHER));
    const out = await iconComparisonFindings(lookupFetch(withMe), batch, input({ chartEntries: withMe }));
    // the vote must be over neighbours only — never ourselves
    expect(out[0]!.evidence).toContain(`of ${TEN.length}`);
  });
});

describe("iconComparisonFindings — measured-or-absent", () => {
  it("emits nothing when we have no icon of our own", async () => {
    const batch = batchOf(conformingTable(OTHER));
    const out = await iconComparisonFindings(lookupFetch(TEN), batch, input({ artworkUrl: undefined }));
    expect(out).toEqual([]);
    expect(batch).not.toHaveBeenCalled(); // and spends nothing
  });

  it("emits nothing when the chart carried no entries", async () => {
    const batch = batchOf(conformingTable(OTHER));
    const out = await iconComparisonFindings(lookupFetch([]), batch, input({ chartEntries: [] }));
    expect(out).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });

  it("emits nothing when neighbour artwork could not be fetched", async () => {
    const notFound = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "",
    })) as never;
    const out = await iconComparisonFindings(notFound, batchOf(conformingTable(OTHER)), input());
    expect(out).toEqual([]);
  });

  it("emits nothing when OUR icon is the one the analyzer could not read", async () => {
    // The neighbours are all measured; without ours there is no comparison.
    const out = await iconComparisonFindings(
      lookupFetch(TEN),
      batchOf(conformingTable(null)),
      input(),
    );
    expect(out).toEqual([]);
  });

  it("stays silent below MIN_NEIGHBOURS rather than calling a small sample a norm", async () => {
    const few = TEN.slice(0, MIN_NEIGHBOURS - 1);
    const table = { [art(MY_ID)]: OTHER, ...Object.fromEntries(few.map((id) => [art(id), CENTRED])) };
    const out = await iconComparisonFindings(lookupFetch(few), batchOf(table), input({ chartEntries: few }));
    expect(out).toEqual([]);
  });

  it("stays silent when the neighbour set has no convention", async () => {
    // 5 centred / 5 other — no side reaches CONVENTION_THRESHOLD.
    const table: Record<string, IconComposition | null> = { [art(MY_ID)]: CENTRED };
    TEN.forEach((id, i) => {
      table[art(id)] = i < 5 ? CENTRED : OTHER;
    });
    const out = await iconComparisonFindings(lookupFetch(TEN), batchOf(table), input());
    expect(out).toEqual([]);
  });

  it("never throws when the analyzer batch itself fails", async () => {
    const boom = vi.fn(async () => {
      throw new Error("model down");
    });
    const out = await iconComparisonFindings(lookupFetch(TEN), boom as never, input());
    expect(out).toEqual([]);
  });
});
