import { describe, expect, it } from "vitest";
import { standingFromHistory } from "./standing.js";
import type { RankSnapshotRow } from "./d1.js";

const row = (o: Partial<RankSnapshotRow>): RankSnapshotRow => ({
  id: "r",
  app_id: "a1",
  keyword: "kw",
  rank: null,
  total: 100,
  country: "us",
  checked_at: "2026-08-01T00:00:00Z",
  ...o,
});

// Heathen's real shape (production D1): strong holds, long unranked tail.
const HEATHEN: RankSnapshotRow[] = [
  row({ keyword: "heathen", rank: 6, total: 36, checked_at: "2026-07-06T00:00:00Z" }),
  row({ keyword: "heathen", rank: 2, total: 42, checked_at: "2026-08-01T00:00:00Z" }),
  row({ keyword: "secular", rank: 1, total: 167 }),
  row({ keyword: "atheist meditation", rank: 4, total: 171 }),
  row({ keyword: "anxiety", rank: null, total: 180 }),
  row({ keyword: "agnostic", rank: null, total: 55 }),
];

describe("standingFromHistory", () => {
  it("takes the LATEST reading per keyword, not the first", () => {
    const v = standingFromHistory(HEATHEN);
    const heathen = v.entries.find((e) => e.keyword === "heathen");
    expect(heathen?.rank).toBe(2);
    expect(heathen?.checked_at).toBe("2026-08-01T00:00:00Z");
  });

  it("picks the latest by TIMESTAMP even when rows arrive newest-first", () => {
    const reversed = [...HEATHEN].reverse();
    const v = standingFromHistory(reversed);
    expect(v.entries.find((e) => e.keyword === "heathen")?.rank).toBe(2);
  });

  it("carries total and checked_at — the fields rankDeltasView drops", () => {
    const v = standingFromHistory(HEATHEN);
    const secular = v.entries.find((e) => e.keyword === "secular");
    expect(secular?.total).toBe(167);
    expect(secular?.checked_at).toBe("2026-08-01T00:00:00Z");
  });

  it("preserves an unranked term as null — never the scan depth", () => {
    const v = standingFromHistory(HEATHEN);
    const anxiety = v.entries.find((e) => e.keyword === "anxiety");
    expect(anxiety?.rank).toBeNull();
    expect(anxiety?.rank).not.toBe(200);
  });

  it("reports an unknown competitor count as null, never 0", () => {
    const v = standingFromHistory([row({ keyword: "x", rank: 3, total: null as never })]);
    expect(v.entries[0]?.total).toBeNull();
  });

  it("leads with the best measured position", () => {
    const v = standingFromHistory(HEATHEN);
    expect(v.entries.slice(0, 3).map((e) => e.rank)).toEqual([1, 2, 4]);
  });

  it("orders the unranked tail by how contested the term is", () => {
    const v = standingFromHistory(HEATHEN);
    const absent = v.entries.filter((e) => e.rank === null).map((e) => e.keyword);
    expect(absent).toEqual(["anxiety", "agnostic"]);
  });

  it("counts ranked against tracked", () => {
    const v = standingFromHistory(HEATHEN);
    expect(v.ranked).toBe(3);
    expect(v.tracked).toBe(5); // heathen counted ONCE despite two snapshots
    expect(v.best).toBe(1);
  });

  it("reports best as null when nothing ranks — never 0", () => {
    const v = standingFromHistory([row({ keyword: "a" }), row({ keyword: "b" })]);
    expect(v.best).toBeNull();
    expect(v.ranked).toBe(0);
    expect(v.tracked).toBe(2);
  });

  it("scopes to the currently-targeted keywords (#74 parity with appDeltas)", () => {
    const v = standingFromHistory(HEATHEN, { keywords: ["secular", "anxiety"] });
    expect(v.entries.map((e) => e.keyword)).toEqual(["secular", "anxiety"]);
    expect(v.tracked).toBe(2);
  });

  it("matches the target list case-insensitively", () => {
    const v = standingFromHistory(HEATHEN, { keywords: ["  SECULAR  "] });
    expect(v.entries.map((e) => e.keyword)).toEqual(["secular"]);
  });

  it("an empty keyword scope means no filter, not an empty view", () => {
    expect(standingFromHistory(HEATHEN, { keywords: [] }).tracked).toBe(5);
  });

  it("returns an honest empty view for no history", () => {
    expect(standingFromHistory([])).toEqual({ entries: [], ranked: 0, tracked: 0, best: null });
  });

  it("the headline gets WORSE when a term drops out", () => {
    const before = standingFromHistory(HEATHEN).ranked;
    const after = standingFromHistory([
      ...HEATHEN,
      row({ keyword: "secular", rank: null, total: 167, checked_at: "2026-08-08T00:00:00Z" }),
    ]).ranked;
    expect(after).toBe(before - 1);
  });
});
