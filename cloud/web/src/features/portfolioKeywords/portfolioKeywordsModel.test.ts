import { describe, it, expect } from "vitest";
import type { PortfolioDeltaEntry } from "@shipaso/api";
import {
  buildFilters,
  buildTiles,
  groupByTerm,
  matchesFilter,
  matchesTerm,
  partitionMeasured,
  TOP_RANK,
} from "./portfolioKeywordsModel.js";

const entry = (o: Partial<PortfolioDeltaEntry>): PortfolioDeltaEntry => ({
  keyword: "habit tracker",
  previous: null,
  current: null,
  delta: null,
  direction: "unmeasured",
  app_id: "a1",
  app_name: "Acme",
  country: "us",
  ...o,
});

const measured = (o: Partial<PortfolioDeltaEntry>): PortfolioDeltaEntry =>
  entry({ previous: 20, current: 12, delta: 8, direction: "up", ...o });

describe("groupByTerm", () => {
  it("gives one term shared by several apps a single lead row and continuations", () => {
    const rows = groupByTerm([
      measured({ keyword: "calorie", app_id: "a1", app_name: "Cal AI", delta: 9, current: 4 }),
      measured({ keyword: "calorie", app_id: "a2", app_name: "Macro", delta: 2, current: 30 }),
      measured({ keyword: "calorie", app_id: "a3", app_name: "Plate", delta: 1, current: 55 }),
    ]);

    expect(rows.map((r) => r.isLead)).toEqual([true, false, false]);
    expect(rows[0].entry.app_name).toBe("Cal AI");
  });

  it("keeps a keyword × app × storefront pair distinct from the same keyword × app elsewhere", () => {
    const rows = groupByTerm([
      measured({ keyword: "sleep", country: "us" }),
      measured({ keyword: "sleep", country: "jp" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("orders terms by their biggest move, continuations following their lead", () => {
    const rows = groupByTerm([
      measured({ keyword: "small", delta: 1, app_id: "a1" }),
      measured({ keyword: "big", delta: 40, app_id: "a1" }),
      measured({ keyword: "small", delta: 2, app_id: "a2" }),
    ]);

    expect(rows.map((r) => r.entry.keyword)).toEqual(["big", "small", "small"]);
    expect(rows[1].entry.app_id).toBe("a2");
  });
});

describe("partitionMeasured", () => {
  it("splits on direction 'unmeasured' rather than re-deriving from the numbers", () => {
    const un = entry({ keyword: "gone", direction: "unmeasured", current: null });
    const { measured: m, unmeasured } = partitionMeasured([measured({ keyword: "here" }), un]);

    expect(m.map((e) => e.keyword)).toEqual(["here"]);
    expect(unmeasured.map((e) => e.keyword)).toEqual(["gone"]);
  });

  it("treats a null current as unmeasured even if direction disagrees", () => {
    const { unmeasured } = partitionMeasured([entry({ direction: "same", current: null })]);
    expect(unmeasured).toHaveLength(1);
  });
});

describe("buildTiles", () => {
  it("derives every tile from the entries it is given", () => {
    const entries = [
      measured({ keyword: "a", app_id: "a1", current: 3, direction: "up", delta: 5 }),
      measured({ keyword: "b", app_id: "a2", current: 8, direction: "down", delta: -2 }),
      measured({ keyword: "c", app_id: "a2", current: 40, direction: "same", delta: 0 }),
      entry({ keyword: "d", app_id: "a2", direction: "unmeasured" }),
    ];

    const tiles = buildTiles(entries);
    const by = (id: string) => tiles.find((t) => t.id === id)!;

    expect(by("tracked").value).toBe("4");
    expect(by("tracked").sub).toBe("across 2 apps · 4 pairs");
    expect(by("measured").value).toBe("3");
    // "not checked" — an unmeasured row means we did not read it, which is not
    // the same claim as "outside the top 200" (that is `lost`, #360).
    expect(by("measured").sub).toBe("1 not checked");
    expect(by("top").value).toBe("2");
    expect(by("top").sub).toBe("of 3 measured");
    expect(by("moved").value).toBe("2");
    expect(by("moved").sub).toBe("1 up · 1 down");
  });

  it("counts distinct terms, not rows, so a shared term is not double-counted", () => {
    const shared = [
      measured({ keyword: "same term", app_id: "a1" }),
      measured({ keyword: "same term", app_id: "a2" }),
    ];
    expect(buildTiles(shared).find((t) => t.id === "tracked")!.value).toBe("1");
  });

  it("reports zero rather than omitting a tile when nothing moved", () => {
    const tiles = buildTiles([measured({ direction: "same", delta: 0, current: 50 })]);
    expect(tiles.find((t) => t.id === "moved")!.value).toBe("0");
    expect(tiles).toHaveLength(4);
  });
});

describe("filters", () => {
  const entries = [
    measured({ keyword: "up one", direction: "up", delta: 4, current: 5 }),
    measured({ keyword: "down one", direction: "down", delta: -4, current: 90 }),
    measured({ keyword: "brand new", direction: "new", previous: null, delta: null, current: 7 }),
    entry({ keyword: "not measured" }),
  ];

  it("counts each chip from the same entries the table renders", () => {
    expect(buildFilters(entries)).toEqual([
      { id: "moved", label: "Moved", count: 2 },
      { id: "top", label: "Top 10", count: 2 },
      { id: "new", label: "New", count: 1 },
      { id: "all", label: "All", count: 4 },
    ]);
  });

  it.each([
    ["moved", ["up one", "down one"]],
    ["top", ["up one", "brand new"]],
    ["new", ["brand new"]],
    ["all", ["up one", "down one", "brand new", "not measured"]],
  ] as const)("filter %s keeps %j", (id, kept) => {
    expect(entries.filter((e) => matchesFilter(e, id)).map((e) => e.keyword)).toEqual(kept);
  });

  it("treats rank exactly TOP_RANK as top 10 and one worse as not", () => {
    expect(matchesFilter(measured({ current: TOP_RANK }), "top")).toBe(true);
    expect(matchesFilter(measured({ current: TOP_RANK + 1 }), "top")).toBe(false);
  });

  it("matches the text filter on term or app name, case-insensitively", () => {
    const e = measured({ keyword: "Sleep Sounds", app_name: "Dozy" });
    expect(matchesTerm(e, "sleep")).toBe(true);
    expect(matchesTerm(e, "DOZ")).toBe(true);
    expect(matchesTerm(e, "  ")).toBe(true);
    expect(matchesTerm(e, "calorie")).toBe(false);
  });
});

/**
 * #360 — "fell out of the results" is not "we didn't check".
 *
 * A lost row has no current rank, so it cannot sit in the ranked table. But
 * filing it under "Not measured this week" states something false: we DID
 * measure, and the term was gone. It gets its own bucket so the screen can say
 * which happened.
 */
describe("lost keywords are separated from unmeasured ones", () => {
  const lost = entry({ keyword: "meal log", previous: 9, current: null, direction: "lost" });
  const never = entry({ keyword: "diet tracker", previous: null, current: null, direction: "unmeasured" });
  const ranked = entry({ keyword: "calorie counter", previous: 11, current: 9, delta: 2, direction: "up" });

  it("partitions lost out of BOTH the measured table and the unmeasured list", () => {
    const { measured, unmeasured, lost: fell } = partitionMeasured([ranked, lost, never]);
    expect(measured.map((e) => e.keyword)).toEqual(["calorie counter"]);
    expect(unmeasured.map((e) => e.keyword)).toEqual(["diet tracker"]);
    expect(fell.map((e) => e.keyword)).toEqual(["meal log"]);
  });

  it("counts a lost term as measured in the tiles — we did read it", () => {
    // The "Measured" tile answers "how many did we successfully check?", and a
    // lost term WAS checked. Counting it as unmeasured would undercount our own
    // coverage and hide a real signal.
    const tiles = buildTiles([ranked, lost, never]);
    const measured = tiles.find((t) => t.id === "measured");
    expect(measured?.value).toBe("2");
  });

  it("a lost term is not 'moved' — there is no measurable move to report", () => {
    expect(matchesFilter(lost, "moved")).toBe(false);
    expect(buildFilters([ranked, lost, never]).find((f) => f.id === "moved")?.count).toBe(1);
  });
});
