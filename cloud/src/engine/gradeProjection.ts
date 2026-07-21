/**
 * Grade-delta projection (#26 "Studio") — the honest packaging that closes the
 * screenshot loop: audit grades a set (B), a generated set (ShipShots #153 / CPP
 * #154) addresses the deficits, and this projects the grade that set would reach —
 * "a B (72) → projected A (88) by addressing 2 of 3 levers." That's the
 * before-grade→after-grade story #26 wanted, tied to the proof loop.
 *
 * Honesty, load-bearing:
 *   • PROJECTED, never promised — the after-grade is what the grade model computes
 *     IF the addressed levers are applied; we never claim the set WILL rank/convert,
 *   • reuses the SAME gradeFor + shotLevers the audit uses (no parallel scoring —
 *     a budget change that breaks the mapping fails CI),
 *   • no over-sell — an A / no-headroom / unreadable current grade projects nothing
 *     (shotLevers already returns [] there); a set addressing no lever → no bump,
 *     never a fabricated improvement.
 *
 * Pure: no D1, no network — unit-tested against fixture ShotScores.
 */
import { gradeFor, shotLevers, type Grade, type Lever, type ShotScore } from "./screenshotScore.js";
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";

const SURFACE = "screenshots";
const NOTE = "Projected from the screenshot grade model if you ship this set — not a promise about ranking or conversion.";

export type GradeProjection = {
  fromGrade: Grade;
  fromScore: number;
  toGrade: Grade;
  toScore: number;
  /** the levers this generated set addresses (a subset of shotLevers). */
  addressed: Lever[];
  /** true when there's a real projected improvement to show. */
  improved: boolean;
  note: string;
};

/**
 * Project the grade a generated set would reach from the CURRENT ShotScore + the
 * lever ids it addresses. Cumulative: sums the addressed levers' deltas (capped at
 * 100), then gradeFor the total. Returns improved:false (no bump) for an
 * unreadable/A current grade, or a set that addresses no lever — never a
 * fabricated improvement.
 */
export function projectGrade(current: ShotScore, addressedLeverIds: Array<Lever["id"]>): GradeProjection {
  const fromScore = current.score ?? 0;
  const base: GradeProjection = {
    fromGrade: current.grade,
    fromScore,
    toGrade: current.grade,
    toScore: fromScore,
    addressed: [],
    improved: false,
    note: NOTE,
  };
  // Unreadable / null baseline → can't project (shotLevers also returns [] here).
  if (current.grade === "?" || current.score === null) return base;

  const wanted = new Set(addressedLeverIds);
  const addressed = shotLevers(current).filter((l) => wanted.has(l.id));
  if (addressed.length === 0) return base;

  const gain = addressed.reduce((sum, l) => sum + l.delta, 0);
  const toScore = Math.min(100, fromScore + gain);
  return {
    ...base,
    toGrade: gradeFor(toScore),
    toScore,
    addressed,
    improved: toScore > fromScore,
  };
}

/**
 * Which levers a generated ShipShots/CPP set actually satisfies, inferred from the
 * plan's shape. Conservative — only claims a lever the plan genuinely meets (a set
 * that doesn't reach the recommended count doesn't get "count", etc.), so the
 * projection can never over-credit a weak set.
 */
export function leversAddressedByPlan(
  plan: { shotCount: number; hasIpad: boolean; atTargetAspect: boolean },
  current: ShotScore,
): Array<Lever["id"]> {
  const available = new Set(shotLevers(current).map((l) => l.id));
  const out: Array<Lever["id"]> = [];
  // "count" is satisfied only when the plan ships at least as many shots as the
  // current set (i.e. it genuinely adds shots toward the next count tier).
  if (available.has("count") && plan.shotCount > current.iphoneCount) out.push("count");
  if (available.has("ipad") && plan.hasIpad) out.push("ipad");
  if (available.has("aspect") && plan.atTargetAspect) out.push("aspect");
  return out;
}

/**
 * A finding for a projected grade lift — quotes both grades, lists the driver
 * levers, and carries the "projected, not a promise" caveat. null when there's no
 * improvement to show (silent — never a fabricated bump).
 */
export function gradeProjectionFinding(proj: GradeProjection): Finding | null {
  if (!proj.improved) return null;
  const drivers = proj.addressed.map((l) => l.label).join(", ");
  return mk({
    id: "studio_grade_projection",
    surface: SURFACE,
    severity: "info",
    impact: "conversion",
    title: `Projected screenshot grade: ${proj.fromGrade} → ${proj.toGrade}`,
    detail:
      `Your screenshots grade ${proj.fromGrade} (${proj.fromScore}). A generated set that addresses ${drivers} ` +
      `projects ${proj.toGrade} (${proj.toScore}). ${NOTE}`,
    fix: "Generate and review the set, then ship it to move the grade for real.",
    evidence: `${proj.addressed.length} lever(s) addressed`,
    context: true,
  });
}
