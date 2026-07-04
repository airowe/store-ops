import { describe, expect, it } from "vitest";
import { buildRankAnnotations, type CompetitorSnapshotRow } from "./rankAnnotations.js";

/** #62 T1 — annotation markers from data we already persist. */

const snap = (
  comp_id: string,
  seen_at: string,
  over: Partial<CompetitorSnapshotRow> = {},
): CompetitorSnapshotRow => ({
  comp_id,
  name: "Rival",
  version: "1.0",
  rating: "4.5 (100)",
  seen_at,
  ...over,
});

describe("buildRankAnnotations (#62)", () => {
  it("approved pushes become push markers with the run link", () => {
    const out = buildRankAnnotations({
      pushes: [{ runId: "run-1", pushedAt: "2026-06-01T09:00:00Z" }],
      competitorSnapshots: [],
    });
    expect(out).toEqual([
      { at: "2026-06-01T09:00:00Z", kind: "push", label: "You shipped metadata", runId: "run-1" },
    ]);
  });

  it("a competitor's visible change between consecutive snapshots becomes a marker", () => {
    const out = buildRankAnnotations({
      pushes: [],
      competitorSnapshots: [
        snap("c1", "2026-06-01", { version: "1.0" }),
        snap("c1", "2026-06-08", { version: "1.1" }),
      ],
    });
    expect(out).toEqual([
      { at: "2026-06-08", kind: "competitor", label: "Rival: version 1.0 → 1.1" },
    ]);
  });

  it("the FIRST snapshot is a baseline — never a change marker", () => {
    const out = buildRankAnnotations({
      pushes: [],
      competitorSnapshots: [snap("c1", "2026-06-01")],
    });
    expect(out).toEqual([]);
  });

  it("an empty-side read never asserts a change (couldn't see ≠ changed)", () => {
    const out = buildRankAnnotations({
      pushes: [],
      competitorSnapshots: [
        snap("c1", "2026-06-01", { rating: "" }),
        snap("c1", "2026-06-08", { rating: "4.7 (120)" }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("multiple fields in one diff join into one marker; markers sort by time", () => {
    const out = buildRankAnnotations({
      pushes: [{ runId: "r", pushedAt: "2026-06-05" }],
      competitorSnapshots: [
        snap("c1", "2026-06-01"),
        snap("c1", "2026-06-08", { name: "Rival Pro", version: "2.0" }),
      ],
    });
    expect(out.map((a) => a.kind)).toEqual(["push", "competitor"]);
    expect(out[1]!.label).toBe("Rival Pro: name Rival → Rival Pro, version 1.0 → 2.0");
  });

  it("competitors are diffed independently (no cross-competitor bleed)", () => {
    const out = buildRankAnnotations({
      pushes: [],
      competitorSnapshots: [
        snap("c1", "2026-06-01", { version: "1.0" }),
        snap("c2", "2026-06-08", { version: "9.9", name: "Other" }),
        snap("c1", "2026-06-15", { version: "1.0" }), // unchanged
      ],
    });
    expect(out).toEqual([]); // c2 has one snapshot (baseline); c1 never changed
  });

  it("caps at 60, keeping the most recent markers", () => {
    const pushes = Array.from({ length: 70 }, (_, i) => ({
      runId: `r${i}`,
      pushedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`,
    }));
    const out = buildRankAnnotations({ pushes, competitorSnapshots: [] });
    expect(out).toHaveLength(60);
    // sorted ascending; the earliest 10 got dropped
    const sortedAll = pushes.map((p) => p.pushedAt).sort();
    expect(out[0]!.at).toBe(sortedAll[10]);
  });
});
