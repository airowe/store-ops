import { describe, it, expect } from "vitest";
import { findKeywordGaps, type KeywordGap } from "./keywordGap";
import type { Rank } from "./rankCheck";
import type { Listing as CompetitorListing } from "./competitorWatch";

// ── fixture helpers ──────────────────────────────────────────────────────────

function comp(name: string, subtitle = "", over: Partial<CompetitorListing> = {}): CompetitorListing {
  return {
    key: "id:" + name,
    name,
    subtitle,
    version: "1.0",
    price: "Free",
    rating: "4.5 (100)",
    genres: "Health & Fitness",
    error: "",
    ...over,
  };
}

function rank(keyword: string, r: number | null): Rank {
  return { keyword, rank: r, foundName: "You", total: 200, limit: 200, error: "" };
}

// A clean, single-purpose fixture: competitors lean on "meditation" + "sleep";
// your listing is a generic productivity app that targets neither.
const yourCopy = { name: "FocusFlow", subtitle: "Productivity timer", keywords: "timer,focus,pomodoro" };

describe("findKeywordGaps — gap detection", () => {
  it("surfaces a term competitors use that you do not target or rank for", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [rank("timer", 4)],
      competitors: [comp("Calm", "Meditation and Sleep"), comp("Headspace", "Guided Meditation")],
    });
    const meditation = gaps.find((g) => g.keyword === "meditation");
    expect(meditation).toBeDefined();
    expect(meditation?.inYourMetadata).toBe(false);
    expect(meditation?.youRank).toBeNull();
    // attribution: BOTH competitors use the term, by name.
    expect(meditation?.competitorsUsing).toEqual(expect.arrayContaining(["Calm", "Headspace"]));
  });

  it("attributes each competitor that uses the term (by visible name/subtitle)", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [],
      competitors: [comp("Calm", "Sleep and Meditation"), comp("Streaks", "Habit Tracker")],
    });
    const meditation = gaps.find((g) => g.keyword === "meditation");
    expect(meditation?.competitorsUsing).toEqual(["Calm"]);
    const habit = gaps.find((g) => g.keyword === "habit");
    expect(habit?.competitorsUsing).toEqual(["Streaks"]);
  });
});

describe("findKeywordGaps — exclusion rules", () => {
  it("excludes terms already present in your metadata (name/subtitle/keywords)", () => {
    const gaps = findKeywordGaps({
      yourCopy: { name: "Calm Meditation", subtitle: "Sleep", keywords: "relax" },
      yourRanks: [],
      // competitor uses meditation (in your name), sleep (in your subtitle), relax (in your keywords)
      competitors: [comp("Rival", "Meditation Sleep Relax")],
    });
    expect(gaps.map((g) => g.keyword)).not.toContain("meditation");
    expect(gaps.map((g) => g.keyword)).not.toContain("sleep");
    expect(gaps.map((g) => g.keyword)).not.toContain("relax");
  });

  it("excludes terms you already rank top-50 for (no gap if you're already there)", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [rank("meditation", 12)], // you already rank #12 — not a gap
      competitors: [comp("Calm", "Best Meditation")],
    });
    expect(gaps.map((g) => g.keyword)).not.toContain("meditation");
  });

  it("KEEPS terms you rank deeper than top-50 for (rank 51+ is still a gap)", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [rank("meditation", 87)],
      competitors: [comp("Calm", "Best Meditation")],
    });
    const m = gaps.find((g) => g.keyword === "meditation");
    expect(m).toBeDefined();
    expect(m?.youRank).toBe(87);
  });

  it("excludes generic stopwords and the competitor's own brand name", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [],
      competitors: [comp("Calm", "The Best App For Sleep And Meditation")],
    });
    const keywords = gaps.map((g) => g.keyword);
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("and");
    expect(keywords).not.toContain("for");
    // the competitor's own brand token isn't a keyword you'd target
    expect(keywords).not.toContain("calm");
  });
});

describe("findKeywordGaps — case-insensitive matching", () => {
  it("does not re-surface a term that's in your metadata under different casing", () => {
    const gaps = findKeywordGaps({
      yourCopy: { name: "Meditation Pro", subtitle: "", keywords: "" },
      yourRanks: [],
      competitors: [comp("Rival", "MEDITATION for everyone")],
    });
    expect(gaps.map((g) => g.keyword)).not.toContain("meditation");
  });

  it("merges the same term across competitors regardless of casing", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [],
      competitors: [comp("Calm", "Meditation"), comp("Headspace", "MEDITATION app")],
    });
    const m = gaps.find((g) => g.keyword === "meditation");
    expect(m?.competitorsUsing.sort()).toEqual(["Calm", "Headspace"]);
  });
});

describe("findKeywordGaps — sort order", () => {
  it("sorts not-in-metadata first, then by score descending", () => {
    // override the scorer so "highvalue" outscores "lowvalue" deterministically.
    const score = (kw: string) => (kw === "highvalue" ? 90 : 20);
    const gaps = findKeywordGaps({
      yourCopy: { name: "App", subtitle: "", keywords: "" },
      yourRanks: [],
      competitors: [comp("A", "lowvalue highvalue")],
      scoreKeyword: (kw) => score(kw),
    });
    const real = gaps.filter((g) => !g.inYourMetadata).map((g) => g.keyword);
    expect(real.indexOf("highvalue")).toBeLessThan(real.indexOf("lowvalue"));
  });
});

describe("findKeywordGaps — budget flag", () => {
  it("flags fitsBudget=false when the term cannot fit the remaining keyword chars", () => {
    // keyword field nearly full (97/100); a 12-char term + comma won't fit.
    const nearFull = "a".repeat(97);
    const gaps = findKeywordGaps({
      yourCopy: { name: "App", subtitle: "", keywords: nearFull },
      yourRanks: [],
      competitors: [comp("A", "Meditationxx")], // "meditationxx" = 12 chars
    });
    const m = gaps.find((g) => g.keyword === "meditationxx");
    expect(m?.fitsBudget).toBe(false);
  });

  it("flags fitsBudget=true when there's ample remaining keyword room", () => {
    const gaps = findKeywordGaps({
      yourCopy: { name: "App", subtitle: "", keywords: "" },
      yourRanks: [],
      competitors: [comp("A", "Meditation")],
    });
    const m = gaps.find((g) => g.keyword === "meditation");
    expect(m?.fitsBudget).toBe(true);
  });
});

describe("findKeywordGaps — winnability over vanity volume (honesty)", () => {
  // The KEY honesty test for PRD 01 / the overview's "winnable, not just
  // high-volume" principle: a weak app should NOT have a high-volume incumbent
  // term ranked ABOVE a reachable one purely because the volume is bigger. We
  // weight reachability: a term you ALREADY rank near (distance to top-10 small)
  // must outrank a term you're nowhere on, when raw scores are otherwise equal.
  it("prioritizes a reachable term over an unreachable high-volume incumbent at equal base score", () => {
    const gaps = findKeywordGaps({
      yourCopy: { name: "Tiny App", subtitle: "", keywords: "" },
      yourRanks: [
        rank("reachable", 60), // just outside top-50 — winnable
        // "incumbent" — you're nowhere (null), competitors dominate
      ],
      competitors: [comp("Giant", "reachable incumbent")],
      // equal base score for both terms — reachability must break the tie.
      scoreKeyword: () => 50,
    });
    const order = gaps.filter((g) => !g.inYourMetadata).map((g) => g.keyword);
    expect(order.indexOf("reachable")).toBeLessThan(order.indexOf("incumbent"));
  });
});

describe("findKeywordGaps — graceful degradation", () => {
  it("returns an empty array when there are no competitors", () => {
    expect(findKeywordGaps({ yourCopy, yourRanks: [], competitors: [] })).toEqual([]);
  });

  it("never throws on malformed/errored competitor listings", () => {
    const broken = {
      key: "id:x",
      name: "",
      subtitle: "",
      version: "",
      price: "",
      rating: "",
      genres: "",
      error: "not found",
    } as CompetitorListing;
    expect(() =>
      findKeywordGaps({ yourCopy, yourRanks: [], competitors: [broken, comp("Calm", "Meditation")] }),
    ).not.toThrow();
    const gaps = findKeywordGaps({ yourCopy, yourRanks: [], competitors: [broken, comp("Calm", "Meditation")] });
    expect(gaps.find((g) => g.keyword === "meditation")).toBeDefined();
  });

  it("works without an ASC keyword field (public-listing-only path)", () => {
    const gaps = findKeywordGaps({
      yourCopy: { name: "FocusFlow" }, // no subtitle, no keywords (no ASC read)
      yourRanks: [],
      competitors: [comp("Calm", "Meditation")],
    });
    const m = gaps.find((g) => g.keyword === "meditation");
    expect(m).toBeDefined();
    expect(m?.fitsBudget).toBe(true); // 100 chars all free
  });

  it("produces a stable, deterministic result for the same input", () => {
    const input = {
      yourCopy,
      yourRanks: [rank("timer", 3)],
      competitors: [comp("Calm", "Sleep Meditation"), comp("Headspace", "Daily Meditation")],
    };
    expect(findKeywordGaps(input)).toEqual(findKeywordGaps(input));
  });
});

describe("KeywordGap shape (privacy boundary)", () => {
  it("exposes ONLY safe fields — never the raw competitor listing", () => {
    const gaps = findKeywordGaps({
      yourCopy,
      yourRanks: [],
      competitors: [comp("Calm", "Meditation", { price: "$9.99", version: "3.2.1", genres: "Secret" })],
    });
    const g = gaps.find((x) => x.keyword === "meditation") as KeywordGap;
    expect(Object.keys(g).sort()).toEqual(
      ["competitorsUsing", "fitsBudget", "inYourMetadata", "keyword", "score", "youRank"].sort(),
    );
    // competitorsUsing is names only — no price/version/genres leak.
    expect(JSON.stringify(g)).not.toContain("9.99");
    expect(JSON.stringify(g)).not.toContain("3.2.1");
    expect(JSON.stringify(g)).not.toContain("Secret");
  });
});
