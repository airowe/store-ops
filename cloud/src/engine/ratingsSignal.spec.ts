import { describe, expect, it } from "vitest";
import {
  MIN_RATINGS_FOR_SHAPE,
  RATINGS_THIN,
  type StorefrontRatings,
  ratingsSignal,
} from "./ratingsSignal.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Apple's verbatim numbers for a healthy, well-rated app. */
const APPLE_AVERAGE = 3.9;
const APPLE_COUNT = 4812;

function ratings(over: Partial<StorefrontRatings> = {}): StorefrontRatings {
  return {
    average: APPLE_AVERAGE,
    count: APPLE_COUNT,
    // 1★→5★, a bland J-shape (5★-heavy, small 1★ tail).
    histogram: [100, 100, 300, 1000, 3312],
    ...over,
  };
}

// ── Unknown stays unknown ────────────────────────────────────────────────────

describe("ratingsSignal — absent input", () => {
  it("undefined in → undefined out (unread page stays unknown)", () => {
    expect(ratingsSignal(undefined)).toBeUndefined();
  });
});

describe("ratingsSignal — unreadable histogram degrades the shape only", () => {
  it("histogram: [] (the extractor's unreadable fallback) keeps average/count but no shape fields", () => {
    const signal = ratingsSignal(ratings({ histogram: [] }));
    expect(signal).toBeDefined();
    expect(signal?.average).toBe(APPLE_AVERAGE);
    expect(signal?.count).toBe(APPLE_COUNT);
    expect(signal?.shares).toBeUndefined();
    expect(signal?.polarization).toBeUndefined();
  });

  it("a histogram with the wrong bucket count is unreadable — no shape fields", () => {
    const signal = ratingsSignal(ratings({ histogram: [10, 20, 30, 40] }));
    expect(signal?.shares).toBeUndefined();
    expect(signal?.polarization).toBeUndefined();
  });

  it("an all-zero histogram (sum 0) is unreadable, never treated as measured zeros", () => {
    const signal = ratingsSignal(ratings({ histogram: [0, 0, 0, 0, 0] }));
    expect(signal?.shares).toBeUndefined();
    expect(signal?.polarization).toBeUndefined();
  });
});

// ── Verbatim facts ───────────────────────────────────────────────────────────

describe("ratingsSignal — Apple's numbers carry verbatim", () => {
  it("average and count pass through untouched", () => {
    const signal = ratingsSignal(ratings());
    expect(signal?.average).toBe(APPLE_AVERAGE);
    expect(signal?.count).toBe(APPLE_COUNT);
  });
});

// ── Shape reads ──────────────────────────────────────────────────────────────

describe("ratingsSignal — shares and polarization from a readable histogram", () => {
  it("shares are per-bucket fractions of the histogram total and sum to 1", () => {
    const signal = ratingsSignal(ratings({ histogram: [100, 100, 300, 1000, 3312] }));
    expect(signal?.shares).toBeDefined();
    const shares = signal?.shares ?? [];
    expect(shares.length).toBe(5);
    expect(shares[0]).toBeCloseTo(100 / 4812, 10);
    expect(shares[4]).toBeCloseTo(3312 / 4812, 10);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("polarization.score is share(1★)+share(5★)", () => {
    const signal = ratingsSignal(
      ratings({ count: 1000, histogram: [220, 30, 50, 100, 600] }),
    );
    expect(signal?.polarization?.score).toBeCloseTo(0.22 + 0.6, 10);
  });

  type ShapeCase = {
    name: string;
    count: number;
    histogram: number[];
    bimodal: boolean;
  };
  const SHAPES: ShapeCase[] = [
    {
      name: "U-shape (1★ 22%, 5★ 60%, big n) IS bimodal",
      count: 1000,
      histogram: [220, 30, 50, 100, 600],
      bimodal: true,
    },
    {
      name: "J-shape (1★ 5%) is NOT bimodal",
      count: 1000,
      histogram: [50, 20, 30, 100, 800],
      bimodal: false,
    },
    {
      name: "uniform (5★ 20%) is NOT bimodal",
      count: 1000,
      histogram: [200, 200, 200, 200, 200],
      bimodal: false,
    },
    {
      name: "5★-heavy with no 1★ tail is NOT bimodal",
      count: 1000,
      histogram: [10, 10, 20, 60, 900],
      bimodal: false,
    },
    {
      name: `a U-shape below MIN_RATINGS_FOR_SHAPE (count ${MIN_RATINGS_FOR_SHAPE - 1}) is NEVER called bimodal`,
      count: MIN_RATINGS_FOR_SHAPE - 1,
      histogram: [220, 30, 50, 100, 600],
      bimodal: false,
    },
    {
      name: `the same U-shape at exactly MIN_RATINGS_FOR_SHAPE (count ${MIN_RATINGS_FOR_SHAPE}) IS bimodal`,
      count: MIN_RATINGS_FOR_SHAPE,
      histogram: [220, 30, 50, 100, 600],
      bimodal: true,
    },
  ];

  it.each(SHAPES)("$name", ({ count, histogram, bimodal }) => {
    const signal = ratingsSignal(ratings({ count, histogram }));
    expect(signal?.polarization).toBeDefined();
    expect(signal?.polarization?.bimodal).toBe(bimodal);
  });
});

// ── Thin (Apple's own "Not Enough Ratings" stance) ───────────────────────────

describe("ratingsSignal — thin is a count fact, boundary at RATINGS_THIN", () => {
  it(`count ${RATINGS_THIN - 1} is thin`, () => {
    expect(ratingsSignal(ratings({ count: RATINGS_THIN - 1 }))?.thin).toBe(true);
  });

  it(`count ${RATINGS_THIN} is NOT thin`, () => {
    expect(ratingsSignal(ratings({ count: RATINGS_THIN }))?.thin).toBe(false);
  });

  it("thin still reads even when the histogram is unreadable (independent facts)", () => {
    const signal = ratingsSignal(ratings({ count: RATINGS_THIN - 1, histogram: [] }));
    expect(signal?.thin).toBe(true);
    expect(signal?.shares).toBeUndefined();
  });
});

// ── Determinism (engine contract) ────────────────────────────────────────────

describe("ratingsSignal — determinism", () => {
  it("same input → deep-equal output", () => {
    const a = ratingsSignal(ratings());
    const b = ratingsSignal(ratings());
    expect(a).toEqual(b);
  });
});
