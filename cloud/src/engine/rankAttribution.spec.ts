/**
 * Tests for rank-movement attribution (PRD 02). The proof feature: tie each
 * rank change to the metadata change that (CORRELATIONALLY) preceded it.
 *
 * The honesty discipline is the headline here: attribution copy must NEVER claim
 * causation. The strongest assertion in this suite is a blame test that scans
 * every produced string for causal language ("caused", "because", "due to",
 * "thanks to") across every confidence level.
 */
import { describe, it, expect } from "vitest";
import type { RankSnapshotRow } from "../d1.js";
import {
  attributeRankMovements,
  type PushInput,
  type RankMovement,
} from "./rankAttribution.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const APP = "app-1";

/** One rank snapshot row (the engine only reads keyword/rank/checked_at). */
function snap(keyword: string, rank: number | null, checkedAt: string): RankSnapshotRow {
  return { id: `${keyword}-${checkedAt}`, app_id: APP, keyword, rank, total: 200, country: "us", checked_at: checkedAt };
}

/** A push that proposed `keywords`/`subtitle` over a baseline, approved at `pushedAt`. */
function push(over: Partial<PushInput> & { runId: string; pushedAt: string }): PushInput {
  return {
    proposedKeywords: "",
    proposedSubtitle: "",
    currentKeywords: "",
    currentSubtitle: "",
    ...over,
  };
}

const byKeyword = (out: RankMovement[]): Record<string, RankMovement> =>
  Object.fromEntries(out.map((m) => [m.keyword, m]));

// ── Test 1: basic movement linking (unranked → ranked, exact term added) ──────

describe("attributeRankMovements — linked attribution", () => {
  it("links an unranked→ranked move to the push that added that exact term", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-05 09:00:00"), // baseline: unranked
      snap("stoic", 18, "2026-06-19 09:00:00"), // after the push: #18
    ];
    const pushes = [
      push({
        runId: "run-A",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "calm,focus",
        proposedKeywords: "calm,focus,stoic",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["stoic"]!;

    expect(m.from).toBeNull();
    expect(m.to).toBe(18);
    expect(m.direction).toBe("new");
    expect(m.confidence).toBe("linked");
    expect(m.attributedChange).toBeDefined();
    expect(m.attributedChange!.runId).toBe("run-A");
    expect(m.attributedChange!.addedTerms).toContain("stoic");
    expect(m.attributedChange!.note.toLowerCase()).toContain("stoic");
  });

  it("links a numeric improvement to a push that added the term in the subtitle field", () => {
    const rankHistory = [
      snap("journaling", 50, "2026-06-05 09:00:00"),
      snap("journaling", 22, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-B",
        pushedAt: "2026-06-12 12:00:00",
        currentSubtitle: "Your daily companion",
        proposedSubtitle: "Journaling for a calmer mind",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["journaling"]!;

    expect(m.direction).toBe("up");
    expect(m.delta).toBe(-28);
    expect(m.confidence).toBe("linked");
    expect(m.attributedChange!.addedTerms).toContain("journaling");
  });
});

// ── Test 2: no matching push → coincident ─────────────────────────────────────

describe("attributeRankMovements — coincident (moved, no matching push)", () => {
  it("labels a move with no matching push as coincident with no attributedChange", () => {
    const rankHistory = [
      snap("stoic", 50, "2026-06-05 09:00:00"),
      snap("stoic", 30, "2026-06-19 09:00:00"),
    ];
    // a push exists, but it added a DIFFERENT term — not "stoic".
    const pushes = [
      push({
        runId: "run-C",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "calm",
        proposedKeywords: "calm,mindfulness",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["stoic"]!;

    expect(m.direction).toBe("up");
    expect(m.confidence).toBe("coincident");
    expect(m.attributedChange).toBeUndefined();
  });
});

// ── Test 3: multiple keywords, mixed attribution + a held term ────────────────

describe("attributeRankMovements — mixed attribution", () => {
  it("attributes per keyword independently and marks an unmoved keyword 'none'/same", () => {
    const rankHistory = [
      // moved + linked
      snap("stoic", null, "2026-06-05 09:00:00"),
      snap("stoic", 18, "2026-06-19 09:00:00"),
      // moved + coincident (no push added it)
      snap("calm", 40, "2026-06-05 09:00:00"),
      snap("calm", 25, "2026-06-19 09:00:00"),
      // held steady
      snap("focus", 10, "2026-06-05 09:00:00"),
      snap("focus", 10, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-D",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "calm,focus",
        proposedKeywords: "calm,focus,stoic", // only "stoic" was added
      }),
    ];

    const map = byKeyword(attributeRankMovements({ rankHistory, pushes }));

    expect(map["stoic"]!.confidence).toBe("linked");
    expect(map["stoic"]!.attributedChange!.runId).toBe("run-D");

    expect(map["calm"]!.confidence).toBe("coincident");
    expect(map["calm"]!.attributedChange).toBeUndefined();

    expect(map["focus"]!.direction).toBe("same");
    expect(map["focus"]!.confidence).toBe("none");
    expect(map["focus"]!.attributedChange).toBeUndefined();
  });
});

// ── Test 4: stale push (too far before the move) → coincident, not linked ─────

describe("attributeRankMovements — stale push window", () => {
  it("does not link when the only push that added the term is well outside the window", () => {
    const rankHistory = [
      snap("stoic", 60, "2026-06-12 09:00:00"), // baseline
      snap("stoic", 30, "2026-06-19 09:00:00"), // the move (week of Jun 19)
    ];
    // the push that added "stoic" was approved 5+ weeks before the move.
    const pushes = [
      push({
        runId: "run-E",
        pushedAt: "2026-05-10 12:00:00",
        currentKeywords: "calm",
        proposedKeywords: "calm,stoic",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["stoic"]!;

    expect(m.confidence).toBe("coincident");
    expect(m.attributedChange).toBeUndefined();
  });

  it("links when a push added the term within the attribution window before the move", () => {
    const rankHistory = [
      snap("stoic", 60, "2026-06-12 09:00:00"),
      snap("stoic", 30, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-F",
        pushedAt: "2026-06-13 12:00:00", // day after baseline, before the move
        currentKeywords: "calm",
        proposedKeywords: "calm,stoic",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    expect(byKeyword(out)["stoic"]!.confidence).toBe("linked");
  });

  it("does not link a push that lands AFTER the rank was already checked", () => {
    const rankHistory = [
      snap("stoic", 60, "2026-06-05 09:00:00"),
      snap("stoic", 30, "2026-06-12 09:00:00"), // moved by Jun 12
    ];
    const pushes = [
      push({
        runId: "run-G",
        pushedAt: "2026-06-15 12:00:00", // approved AFTER the move was observed
        currentKeywords: "calm",
        proposedKeywords: "calm,stoic",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    expect(byKeyword(out)["stoic"]!.confidence).toBe("coincident");
    expect(byKeyword(out)["stoic"]!.attributedChange).toBeUndefined();
  });
});

// ── Test 5: HONESTY — never causal language (the key PRD test) ────────────────

describe("attributeRankMovements — honesty (correlation, never causation)", () => {
  const CAUSAL = [
    "caused",
    "because",
    "due to",
    "thanks to",
    "as a result of",
    "drove",
    "responsible for",
    "led to",
  ];

  it("emits no causal language in any attributedChange.note across confidences", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-05 09:00:00"),
      snap("stoic", 18, "2026-06-19 09:00:00"),
      snap("calm", 40, "2026-06-05 09:00:00"),
      snap("calm", 25, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-H",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "focus",
        proposedKeywords: "focus,stoic",
        currentSubtitle: "Old",
        proposedSubtitle: "Stoic calm",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const notes = out.flatMap((m) => (m.attributedChange ? [m.attributedChange.note] : []));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      const lower = note.toLowerCase();
      for (const marker of CAUSAL) {
        expect(lower).not.toContain(marker);
      }
    }
  });

  it("uses correlational framing ('after you added') in linked notes", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-05 09:00:00"),
      snap("stoic", 18, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-I",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "",
        proposedKeywords: "stoic",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    expect(out[0]!.attributedChange!.note.toLowerCase()).toContain("after you added");
  });
});

// ── Test 6: edge cases ────────────────────────────────────────────────────────

describe("attributeRankMovements — edge cases", () => {
  it("null → null is 'same' / 'none' (still unranked, no attribution)", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-05 09:00:00"),
      snap("stoic", null, "2026-06-19 09:00:00"),
    ];
    const out = attributeRankMovements({ rankHistory, pushes: [] });
    const m = byKeyword(out)["stoic"]!;
    expect(m.direction).toBe("same");
    expect(m.confidence).toBe("none");
  });

  it("ranked → unranked is 'lost' with a null delta", () => {
    const rankHistory = [
      snap("stoic", 30, "2026-06-05 09:00:00"),
      snap("stoic", null, "2026-06-19 09:00:00"),
    ];
    const out = attributeRankMovements({ rankHistory, pushes: [] });
    const m = byKeyword(out)["stoic"]!;
    expect(m.direction).toBe("lost");
    expect(m.delta).toBeNull();
    // a lost keyword is never "linked" to a push that added it.
    expect(m.confidence).toBe("coincident");
  });

  it("a single snapshot yields direction 'new' and confidence 'coincident'", () => {
    const rankHistory = [snap("stoic", 18, "2026-06-19 09:00:00")];
    const out = attributeRankMovements({ rankHistory, pushes: [] });
    const m = byKeyword(out)["stoic"]!;
    expect(m.direction).toBe("new");
    expect(m.from).toBeNull();
    expect(m.to).toBe(18);
    expect(m.confidence).toBe("coincident");
  });

  it("unions added terms when multiple pushes precede the move, attributing the most recent matching one", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-01 09:00:00"),
      snap("stoic", 18, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-early",
        pushedAt: "2026-06-05 12:00:00",
        currentKeywords: "calm",
        proposedKeywords: "calm,stoic",
      }),
      push({
        runId: "run-late",
        pushedAt: "2026-06-14 12:00:00",
        currentKeywords: "calm,stoic",
        proposedKeywords: "calm,stoic,focus", // did NOT add "stoic"
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["stoic"]!;
    // the most-recent push that actually ADDED "stoic" is run-early.
    expect(m.confidence).toBe("linked");
    expect(m.attributedChange!.runId).toBe("run-early");
  });

  it("matches a term that appears in BOTH the keywords and subtitle fields", () => {
    const rankHistory = [
      snap("stoic", null, "2026-06-05 09:00:00"),
      snap("stoic", 18, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-J",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "calm",
        proposedKeywords: "calm,stoic",
        currentSubtitle: "Old subtitle",
        proposedSubtitle: "Stoic daily calm",
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    const m = byKeyword(out)["stoic"]!;
    expect(m.confidence).toBe("linked");
    expect(m.attributedChange!.addedTerms).toContain("stoic");
  });

  it("ignores pushes that only reorder existing terms (no net additions)", () => {
    const rankHistory = [
      snap("stoic", 40, "2026-06-05 09:00:00"),
      snap("stoic", 20, "2026-06-19 09:00:00"),
    ];
    const pushes = [
      push({
        runId: "run-K",
        pushedAt: "2026-06-12 12:00:00",
        currentKeywords: "stoic,calm,focus",
        proposedKeywords: "focus,calm,stoic", // same set, reordered
      }),
    ];

    const out = attributeRankMovements({ rankHistory, pushes });
    expect(byKeyword(out)["stoic"]!.confidence).toBe("coincident");
  });
});
