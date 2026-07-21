/**
 * Per-market rank proof (#180 Phase 1) — assemble country-scoped rank snapshots
 * into a before/after "you moved in <market>" proof.
 *
 * Invariants pinned here:
 *   • each market's proof is measured ONLY from that market's snapshots (no blend),
 *   • movement uses rankAttribution's exact vocabulary (new/lost/up/down/same),
 *   • a market with < MIN_SNAPSHOTS distinct dates → measured:false (no fabricated
 *     move); a null rank stays unranked, never a fake position,
 *   • `since` trims the window to on/after the localized push date,
 *   • findings are correlational — "since your push", never "caused".
 */
import { describe, expect, it } from "vitest";
import type { RankSnapshotRow } from "../d1.js";
import { buildMarketProof, marketProofFindings, MIN_SNAPSHOTS } from "./marketRankProof.js";

let seq = 0;
function row(p: Partial<RankSnapshotRow> = {}): RankSnapshotRow {
  return {
    id: `r${seq++}`,
    app_id: "a1",
    keyword: "weather",
    rank: 5,
    total: 100,
    country: "jp",
    checked_at: "2026-06-01 08:00:00",
    ...p,
  };
}

describe("buildMarketProof", () => {
  it("groups by market and computes earliest→latest per keyword", () => {
    const rows = [
      row({ country: "jp", keyword: "weather", rank: 12, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "jp", keyword: "weather", rank: 4, checked_at: "2026-06-20 08:00:00" }),
      row({ country: "de", keyword: "wetter", rank: 30, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "de", keyword: "wetter", rank: 9, checked_at: "2026-06-20 08:00:00" }),
    ];
    const proofs = buildMarketProof(rows);
    const jp = proofs.find((p) => p.country === "jp")!;
    expect(jp.keywords[0]!.from).toBe(12);
    expect(jp.keywords[0]!.to).toBe(4);
    expect(jp.keywords[0]!.delta).toBe(-8); // improved
    expect(jp.keywords[0]!.direction).toBe("up");
    expect(jp.measured).toBe(true);
    expect(proofs.map((p) => p.country).sort()).toEqual(["de", "jp"]);
  });

  it("marks a market with < MIN_SNAPSHOTS distinct dates measured:false (no fabricated move)", () => {
    const proofs = buildMarketProof([row({ country: "fr", checked_at: "2026-06-01 08:00:00" })]);
    const fr = proofs.find((p) => p.country === "fr")!;
    expect(fr.measured).toBe(false);
    expect(MIN_SNAPSHOTS).toBe(2);
  });

  it("classifies null ranks as new / lost (never a fake position)", () => {
    const entered = buildMarketProof([
      row({ country: "jp", keyword: "k", rank: null, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "jp", keyword: "k", rank: 7, checked_at: "2026-06-20 08:00:00" }),
    ]);
    expect(entered[0]!.keywords[0]!.direction).toBe("new");
    expect(entered[0]!.keywords[0]!.delta).toBeNull();

    const lost = buildMarketProof([
      row({ country: "jp", keyword: "k", rank: 7, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "jp", keyword: "k", rank: null, checked_at: "2026-06-20 08:00:00" }),
    ]);
    expect(lost[0]!.keywords[0]!.direction).toBe("lost");
  });

  it("trims each market's window to on/after the localized push date (since)", () => {
    const rows = [
      row({ country: "jp", keyword: "weather", rank: 40, checked_at: "2026-05-01 08:00:00" }), // pre-push, excluded
      row({ country: "jp", keyword: "weather", rank: 12, checked_at: "2026-06-05 08:00:00" }),
      row({ country: "jp", keyword: "weather", rank: 4, checked_at: "2026-06-20 08:00:00" }),
    ];
    const proofs = buildMarketProof(rows, { since: { jp: "2026-06-01" } });
    // window starts at the push → from should be 12 (not the pre-push 40)
    expect(proofs[0]!.keywords[0]!.from).toBe(12);
    expect(proofs[0]!.since).toBe("2026-06-01");
  });

  it("computes netImproved across the market's keywords", () => {
    const rows = [
      row({ country: "jp", keyword: "a", rank: 10, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "jp", keyword: "a", rank: 3, checked_at: "2026-06-20 08:00:00" }), // up
      row({ country: "jp", keyword: "b", rank: 5, checked_at: "2026-06-01 08:00:00" }),
      row({ country: "jp", keyword: "b", rank: 9, checked_at: "2026-06-20 08:00:00" }), // down
    ];
    const jp = buildMarketProof(rows)[0]!;
    expect(jp.netImproved).toBe(0); // 1 up − 1 down
  });

  it("empty rows → []", () => {
    expect(buildMarketProof([])).toEqual([]);
  });
});

describe("marketProofFindings", () => {
  const climbedJp = buildMarketProof([
    row({ country: "jp", keyword: "weather", rank: 12, checked_at: "2026-06-01 08:00:00" }),
    row({ country: "jp", keyword: "weather", rank: 4, checked_at: "2026-06-20 08:00:00" }),
  ]);

  it("a measured, improved market gets a correlational finding (never 'caused')", () => {
    const f = marketProofFindings(climbedJp, { locales: { jp: "ja" } })[0]!;
    expect(f.surface).toBe("localization");
    expect(f.detail.toLowerCase()).not.toMatch(/caused/);
    expect(f.detail).toMatch(/jp|japan/i);
  });

  it("an unmeasured market is silent (no noise)", () => {
    const unmeasured = buildMarketProof([row({ country: "fr", checked_at: "2026-06-01 08:00:00" })]);
    expect(marketProofFindings(unmeasured)).toEqual([]);
  });

  it("empty → no findings", () => {
    expect(marketProofFindings([])).toEqual([]);
  });
});
