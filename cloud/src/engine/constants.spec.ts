import { describe, it, expect } from "vitest";
import {
  CHAR_LIMITS,
  KEYWORD_WEIGHTS,
  SCREENSHOT,
  RUN_STATUSES,
  BUCKET_TO_FIELD,
} from "./constants";

// Smoke tests that lock the LOAD-BEARING constants ported from the Python libs.
// These are the numbers the whole product depends on — if a refactor changes
// one, this fails loudly.

describe("CHAR_LIMITS (hard App Store field limits)", () => {
  it.each([
    ["name", 30],
    ["subtitle", 30],
    ["keywords", 100],
    ["promo", 170],
    ["description", 4000],
  ] as const)("%s = %i", (field, limit) => {
    expect(CHAR_LIMITS[field]).toBe(limit);
  });
});

describe("keyword scoring weights sum to 1", () => {
  it("volume*0.4 + (100-difficulty)*0.3 + relevance*0.3", () => {
    const sum =
      KEYWORD_WEIGHTS.volume + KEYWORD_WEIGHTS.difficulty + KEYWORD_WEIGHTS.relevance;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("screenshot constants", () => {
  it("match aso_screenshot_score.py", () => {
    expect(SCREENSHOT).toMatchObject({
      MAX_SLOTS: 10,
      GOOD_MIN: 4,
      KEY_SLOTS: 3,
      TALL_RATIO: 2.0,
    });
  });
});

describe("run lifecycle", () => {
  it("matches the approval-gate enum in schema.sql", () => {
    expect(RUN_STATUSES).toEqual([
      "detected",
      "researching",
      "awaiting_approval",
      "approved",
      "rejected",
      "shipped",
    ]);
  });
});

describe("keyword bucket → store field mapping", () => {
  it("Aspirational is track-only (no field)", () => {
    expect(BUCKET_TO_FIELD.Aspirational).toBeNull();
    expect(BUCKET_TO_FIELD.Primary).toBe("name");
    expect(BUCKET_TO_FIELD.Secondary).toBe("subtitle");
    expect(BUCKET_TO_FIELD["Long-tail"]).toBe("keywords");
  });
});
