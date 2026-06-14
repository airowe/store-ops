/**
 * Portfolio summary — PURE aggregation over an in-memory AppCard[], no DB and no
 * network. The API layer is responsible for assembling the cards (one per app,
 * folding in the latest run's grade / lead keyword / pending-gate state); this
 * module only reduces that list into the fleet-level summary the dashboard shows.
 *
 * Everything here is exercised with hand-built AppCard[] fixtures so the math
 * (totals, the grade histogram with its null-skipping, the pending-approval and
 * tracked counts) is asserted directly, and the input ordering is proven stable.
 */
import { describe, expect, it } from "vitest";
import { summarizePortfolio, type AppCard, type PortfolioSummary } from "./portfolio.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;
/** Build an AppCard with sensible defaults; override only the fields a test cares about. */
function card(over: Partial<AppCard> = {}): AppCard {
  const n = seq++;
  return {
    appId: `app-${n}`,
    name: `App ${n}`,
    grade: null,
    leadKeyword: null,
    leadRank: null,
    pendingApproval: false,
    ...over,
  };
}

// ── empty portfolio ─────────────────────────────────────────────────────────

describe("summarizePortfolio — empty portfolio", () => {
  it("returns all-zero counts, an empty grade breakdown, and empty cards", () => {
    const summary = summarizePortfolio([]);
    expect(summary).toStrictEqual<PortfolioSummary>({
      totalApps: 0,
      pendingApprovals: 0,
      gradeBreakdown: {},
      appsTracked: 0,
      cards: [],
    });
  });
});

// ── single app ────────────────────────────────────────────────────────────────

describe("summarizePortfolio — single app", () => {
  it("counts one tracked, graded, pending app correctly", () => {
    const only = card({
      grade: "A",
      leadKeyword: "habit tracker",
      leadRank: 3,
      pendingApproval: true,
    });
    const summary = summarizePortfolio([only]);

    expect(summary.totalApps).toBe(1);
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.appsTracked).toBe(1);
    expect(summary.gradeBreakdown).toStrictEqual({ A: 1 });
    expect(summary.cards).toStrictEqual([only]);
  });

  it("counts a single ungraded, untracked, non-pending app as all zeros but totalApps 1", () => {
    const summary = summarizePortfolio([card()]);
    expect(summary.totalApps).toBe(1);
    expect(summary.pendingApprovals).toBe(0);
    expect(summary.appsTracked).toBe(0);
    expect(summary.gradeBreakdown).toStrictEqual({});
  });
});

// ── grade histogram ─────────────────────────────────────────────────────────

describe("summarizePortfolio — gradeBreakdown histogram", () => {
  it("buckets multiple apps that share a grade letter", () => {
    const cards = [
      card({ grade: "A" }),
      card({ grade: "A" }),
      card({ grade: "A" }),
      card({ grade: "B" }),
    ];
    const { gradeBreakdown } = summarizePortfolio(cards);
    expect(gradeBreakdown).toStrictEqual({ A: 3, B: 1 });
  });

  it("skips null grades entirely (no null/'null' key, no inflated counts)", () => {
    const cards = [
      card({ grade: "F" }),
      card({ grade: null }),
      card({ grade: null }),
      card({ grade: "F" }),
      card({ grade: "C" }),
    ];
    const { gradeBreakdown } = summarizePortfolio(cards);
    expect(gradeBreakdown).toStrictEqual({ F: 2, C: 1 });
    expect(gradeBreakdown).not.toHaveProperty("null");
    expect(Object.keys(gradeBreakdown)).toHaveLength(2);
  });

  it("returns an empty breakdown when every grade is null", () => {
    const cards = [card({ grade: null }), card({ grade: null })];
    expect(summarizePortfolio(cards).gradeBreakdown).toStrictEqual({});
  });

  it("keys distinct grades separately across the full A–F spread", () => {
    const cards = [
      card({ grade: "A" }),
      card({ grade: "B" }),
      card({ grade: "C" }),
      card({ grade: "D" }),
      card({ grade: "F" }),
    ];
    expect(summarizePortfolio(cards).gradeBreakdown).toStrictEqual({
      A: 1,
      B: 1,
      C: 1,
      D: 1,
      F: 1,
    });
  });
});

// ── pendingApprovals count ──────────────────────────────────────────────────

describe("summarizePortfolio — pendingApprovals", () => {
  it("counts only the cards flagged pendingApproval", () => {
    const cards = [
      card({ pendingApproval: true }),
      card({ pendingApproval: false }),
      card({ pendingApproval: true }),
      card({ pendingApproval: true }),
    ];
    const summary = summarizePortfolio(cards);
    expect(summary.pendingApprovals).toBe(3);
    expect(summary.totalApps).toBe(4);
  });

  it("is zero when no card is pending", () => {
    const cards = [card({ pendingApproval: false }), card({ pendingApproval: false })];
    expect(summarizePortfolio(cards).pendingApprovals).toBe(0);
  });
});

// ── appsTracked count ───────────────────────────────────────────────────────

describe("summarizePortfolio — appsTracked", () => {
  it("counts cards with a non-null leadRank, including rank 0 and below-top results", () => {
    const cards = [
      card({ leadRank: 1 }),
      card({ leadRank: 0 }),
      card({ leadRank: 150 }),
      card({ leadRank: null }),
    ];
    expect(summarizePortfolio(cards).appsTracked).toBe(3);
  });

  it("does not count a card with a leadKeyword but a null leadRank", () => {
    const cards = [
      card({ leadKeyword: "sleep timer", leadRank: null }),
      card({ leadKeyword: "white noise", leadRank: 7 }),
    ];
    expect(summarizePortfolio(cards).appsTracked).toBe(1);
  });

  it("is zero when every leadRank is null", () => {
    const cards = [card({ leadRank: null }), card({ leadRank: null })];
    expect(summarizePortfolio(cards).appsTracked).toBe(0);
  });
});

// ── ordering + passthrough ──────────────────────────────────────────────────

describe("summarizePortfolio — cards passthrough + ordering", () => {
  it("returns the cards in input order, unchanged", () => {
    const cards = [
      card({ appId: "zebra", grade: "C" }),
      card({ appId: "alpha", grade: "A" }),
      card({ appId: "mike", grade: "B" }),
    ];
    const summary = summarizePortfolio(cards);
    expect(summary.cards.map((c) => c.appId)).toStrictEqual(["zebra", "alpha", "mike"]);
    expect(summary.cards).toStrictEqual(cards);
  });

  it("aggregates a mixed portfolio across every dimension at once", () => {
    const cards = [
      card({ grade: "A", leadRank: 2, pendingApproval: true }),
      card({ grade: "A", leadRank: null, pendingApproval: false }),
      card({ grade: null, leadRank: 9, pendingApproval: true }),
      card({ grade: "F", leadRank: null, pendingApproval: false }),
    ];
    const summary = summarizePortfolio(cards);
    expect(summary).toStrictEqual<PortfolioSummary>({
      totalApps: 4,
      pendingApprovals: 2,
      gradeBreakdown: { A: 2, F: 1 },
      appsTracked: 2,
      cards,
    });
  });
});
