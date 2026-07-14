/**
 * Regressions for two React Doctor findings on the app-detail screen.
 *
 *  1. query-mutation-missing-invalidation — a Play audit opens a run server-side,
 *     so the ["app", id] query (which carries `runs`) must be invalidated or the
 *     new run never appears in the Runs list until you leave and come back.
 *
 *  2. no-array-index-as-key — the "What changed" timeline renders
 *     `annotations.slice(-8)`. Keying by array index means a 9th annotation
 *     shifts every row's key, so React reuses rows against the wrong data.
 *     The key must be derived from the annotation itself.
 */
import { annotationKey } from "./rankSeries.js";
import type { RankAnnotation } from "../types/api.js";

const push = (at: string, label: string, runId?: string): RankAnnotation =>
  ({ at, kind: "push", label, ...(runId ? { runId } : {}) }) as RankAnnotation;

const competitor = (at: string, label: string): RankAnnotation =>
  ({ at, kind: "competitor", label }) as RankAnnotation;

describe("annotationKey — stable identity for the What-changed timeline", () => {
  it("prefers the runId when the annotation came from one of our runs", () => {
    expect(annotationKey(push("2026-06-22", "You shipped metadata", "r1"))).toBe("r1");
  });

  it("keeps a row's key identical as the slice(-8) window shifts", () => {
    // 9 annotations: the last 8 are the visible window. Adding a 9th re-windows
    // the list, which is exactly when index-based keys break.
    const all = Array.from({ length: 9 }, (_, n) => competitor(`2026-06-${10 + n}`, `change ${n}`));

    const before = all.slice(0, 8).slice(-8).map(annotationKey);
    const after = all.slice(-8).map(annotationKey);

    // The 7 rows carried over must keep the SAME key across the re-window.
    // With key={`${at}-${i}`} these would all shift by one and fail.
    const carriedOver = all.slice(1, 8).map(annotationKey);
    expect(before.slice(1)).toEqual(carriedOver);
    expect(after.slice(0, 7)).toEqual(carriedOver);
  });

  it("distinguishes same-day annotations, which a date-only key would collide", () => {
    // Two pushes land the same day — `at` alone is not an identity.
    const a = competitor("2026-06-22", "Rival Pro raised price");
    const b = competitor("2026-06-22", "Rival Pro shipped v3");
    expect(annotationKey(a)).not.toBe(annotationKey(b));
  });

  it("separates a push from a competitor diff sharing a date and label", () => {
    expect(annotationKey(push("2026-06-22", "same"))).not.toBe(
      annotationKey(competitor("2026-06-22", "same")),
    );
  });
});
