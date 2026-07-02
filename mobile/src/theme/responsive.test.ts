import { chunk, resolveLayout, CONTENT_MAX_WIDTH, TABLET_MIN_WIDTH } from "./responsive.js";

describe("resolveLayout", () => {
  it("phone (iPhone widths): single column, full-width content", () => {
    for (const w of [375, 390, 428, 767]) {
      const l = resolveLayout(w);
      expect(l.isTablet).toBe(false);
      expect(l.columns).toBe(1);
      expect(l.contentMaxWidth).toBe(w); // no cap on phone
    }
  });

  it("iPad portrait (768–834): tablet, 2 columns, capped + centered content", () => {
    for (const w of [TABLET_MIN_WIDTH, 810, 834, 1024]) {
      const l = resolveLayout(w);
      expect(l.isTablet).toBe(true);
      expect(l.columns).toBe(2);
      expect(l.contentMaxWidth).toBe(CONTENT_MAX_WIDTH);
    }
  });

  it("large landscape iPad (≥1180): 3 columns", () => {
    expect(resolveLayout(1194).columns).toBe(3);
    expect(resolveLayout(1366).columns).toBe(3);
  });

  it("tablet gutter is larger than phone gutter", () => {
    expect(resolveLayout(834).gutter).toBeGreaterThan(resolveLayout(390).gutter);
  });
});

describe("chunk", () => {
  it("splits into rows of the given column count", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3, 4], 1)).toEqual([[1], [2], [3], [4]]);
  });

  it("treats columns < 1 as a single column (never divides by zero)", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("empty input → no rows", () => {
    expect(chunk([], 2)).toEqual([]);
  });
});
