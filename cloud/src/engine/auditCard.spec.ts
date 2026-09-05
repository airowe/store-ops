import { describe, expect, it } from "vitest";
import { auditCard, asoHeadline, type AuditCardInput } from "./auditCard.js";
import type { Rank } from "./rankCheck.js";
import type { Finding } from "./findings/core.js";
import { mk } from "./findings/core.js";

const NOW = "2026-09-05T12:00:00.000Z";

const rank = (keyword: string, r: number | null, extra: Partial<Rank> = {}): Rank => ({
  keyword,
  rank: r,
  foundName: r === null ? "" : "Acme",
  total: 150,
  limit: 200,
  error: "",
  ...extra,
});

const finding = (id: string, severity: Finding["severity"]): Finding =>
  mk({ id, surface: "title", severity, impact: "ranking", title: `T ${id}`, detail: "d", fix: "f", evidence: "e" });

const input = (o: Partial<AuditCardInput> = {}): AuditCardInput => ({
  listing: {
    trackName: "Acme Habits",
    sellerName: "Acme Labs",
    artworkUrl512: "https://example.com/icon.png",
    releaseDate: "2024-03-01T00:00:00Z",
    currentVersionReleaseDate: "2026-08-20T00:00:00Z",
    primaryGenreName: "Productivity",
    genres: ["Productivity", "Lifestyle"],
    formattedPrice: "Free",
    averageUserRating: 4.62,
    userRatingCount: 1283,
    fileSizeBytes: "52428800",
    screenshotUrls: ["https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png", "https://example.com/4.png"],
  },
  score: 67,
  grade: "B",
  ranks: [rank("habit tracker", 7), rank("streaks", 41), rank("productivity", null)],
  findings: [finding("a", "critical"), finding("b", "warn"), finding("c", "info")],
  country: "US",
  now: NOW,
  ...o,
});

describe("asoHeadline — the finding a scraper cannot produce", () => {
  it("names found-of-tested and the best measured rank with its keyword", () => {
    expect(asoHeadline(input().ranks)).toBe("Found for 2 of 3 keywords tested. Best rank #7 for “habit tracker”.");
  });
  it("says nothing was found without inventing a best rank", () => {
    expect(asoHeadline([rank("a", null), rank("b", null)])).toBe("Not found for any of the 2 keywords tested (top 200).");
  });
  it("says no keywords were measured when none were", () => {
    expect(asoHeadline([])).toBe("No keywords measured yet.");
  });
  it("excludes keywords whose check failed from the count — an error is not a miss", () => {
    expect(asoHeadline([rank("a", 3), rank("b", null, { error: "timeout" })])).toBe(
      "Found for 1 of 1 keywords tested. Best rank #3 for “a”.",
    );
  });
});

describe("auditCard — measured or nothing, with provenance on every number", () => {
  it("carries the public listing as measured values with source and asOf", () => {
    const c = auditCard(input());
    expect(c.identity.name).toBe("Acme Habits");
    expect(c.identity.developer).toEqual({ state: "measured", value: "Acme Labs", asOf: NOW, source: "App Store" });
    expect(c.identity.iconUrl).toBe("https://example.com/icon.png");
    expect(c.tiles.rating).toEqual({ state: "measured", value: { avg: 4.6, count: 1283 }, asOf: NOW, source: "App Store" });
    expect(c.tiles.size).toEqual({ state: "measured", value: "50 MB", asOf: NOW, source: "App Store" });
    expect(c.chips.category).toEqual({ state: "measured", value: "Productivity", asOf: NOW, source: "App Store" });
    expect(c.chips.price).toEqual({ state: "measured", value: "Free", asOf: NOW, source: "App Store" });
  });

  it("never emits a download or proceeds number in v1 — both hero tiles are unavailable with a reason", () => {
    const c = auditCard(input());
    expect(c.hero.downloads.state).toBe("unavailable");
    expect(c.hero.proceeds.state).toBe("unavailable");
    for (const v of [c.hero.downloads, c.hero.proceeds]) {
      expect("value" in v).toBe(false);
      expect((v as { reason: string }).reason.length).toBeGreaterThan(0);
    }
  });

  it("renders a rating with zero count as absent, not as 0 stars", () => {
    const c = auditCard(input({ listing: { ...input().listing, averageUserRating: 0, userRatingCount: 0 } }));
    expect(c.tiles.rating).toEqual({ state: "absent" });
  });

  it("marks every unread listing field unavailable rather than guessing", () => {
    const c = auditCard(input({ listing: { trackName: "Bare" } }));
    expect(c.identity.developer.state).toBe("unavailable");
    expect(c.identity.iconUrl).toBeNull();
    expect(c.tiles.size.state).toBe("unavailable");
    expect(c.tiles.rating.state).toBe("unavailable");
    expect(c.chips.category.state).toBe("unavailable");
    expect(c.chips.price.state).toBe("unavailable");
    expect(c.screenshots).toEqual([]);
  });

  it("carries the ASO finding prominently: headline, rank summary with its window, and the top actionable findings", () => {
    const c = auditCard(input());
    expect(c.aso.headline).toBe("Found for 2 of 3 keywords tested. Best rank #7 for “habit tracker”.");
    expect(c.aso.score).toEqual({ state: "measured", value: 67, asOf: NOW, source: "ShipASO listing audit" });
    expect(c.aso.grade).toBe("B");
    expect(c.aso.rankSummary).toEqual({
      state: "measured",
      value: { tested: 3, found: 2, best: { keyword: "habit tracker", rank: 7 } },
      asOf: NOW,
      source: "ShipASO rank check · US · top 200",
    });
    expect(c.aso.topFindings.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("caps the findings at two and drops context rows", () => {
    const many = ["a", "b", "c", "d"].map((id) => finding(id, "warn"));
    const ctx = mk({ id: "ctx", surface: "x", severity: "info", impact: "completeness", title: "t", detail: "d", fix: "f", evidence: "e", context: true });
    const c = auditCard(input({ findings: [ctx, ...many] }));
    expect(c.aso.topFindings).toHaveLength(2);
    expect(c.aso.topFindings.some((f) => f.id === "ctx")).toBe(false);
  });

  it("a brand-new app with no score, no ranks and no findings still renders intentionally", () => {
    const c = auditCard(input({ score: null, grade: null, ranks: [], findings: [] }));
    expect(c.aso.score).toEqual({ state: "absent" });
    expect(c.aso.grade).toBeNull();
    expect(c.aso.headline).toBe("No keywords measured yet.");
    expect(c.aso.rankSummary).toEqual({ state: "absent" });
    expect(c.aso.topFindings).toEqual([]);
  });

  it("keeps at most three screenshots for the strip", () => {
    expect(auditCard(input()).screenshots).toHaveLength(3);
  });

  it("stamps the card with when and where it was measured", () => {
    const c = auditCard(input());
    expect(c.measuredAt).toBe(NOW);
    expect(c.country).toBe("US");
  });
});
