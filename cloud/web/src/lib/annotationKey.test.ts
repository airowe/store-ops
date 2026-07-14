import { describe, it, expect } from "vitest";
import type { RankAnnotation } from "@shipaso/api";
import { annotationKey } from "./annotationKey.js";

const push = (at: string, label: string): RankAnnotation => ({ at, kind: "push", label });
const competitor = (at: string, label: string): RankAnnotation => ({ at, kind: "competitor", label });

describe("annotationKey — stable identity for the What-changed timeline", () => {
  it("keeps a row's key identical as the slice(-8) window shifts", () => {
    // The timeline renders annotations.slice(-8) — a MOVING window. A 9th
    // annotation re-windows the list, which is exactly when an index-based key
    // breaks: every row's index shifts by one and React reconciles rows against
    // the wrong data.
    const all = Array.from({ length: 9 }, (_, n) => competitor(`2026-06-${10 + n}`, `change ${n}`));

    const before = all.slice(0, 8).slice(-8).map(annotationKey);
    const after = all.slice(-8).map(annotationKey);
    const carriedOver = all.slice(1, 8).map(annotationKey);

    // The 7 rows present in BOTH windows must keep the same key across the shift.
    expect(before.slice(1)).toEqual(carriedOver);
    expect(after.slice(0, 7)).toEqual(carriedOver);
  });

  it("distinguishes same-day annotations, which a date-only key would collide", () => {
    // Two competitor changes land the same day — `at` alone is not an identity.
    expect(annotationKey(competitor("2026-06-22", "Rival raised price"))).not.toBe(
      annotationKey(competitor("2026-06-22", "Rival shipped v3")),
    );
  });

  it("separates a push from a competitor diff sharing a date and label", () => {
    expect(annotationKey(push("2026-06-22", "same"))).not.toBe(
      annotationKey(competitor("2026-06-22", "same")),
    );
  });
});
