/**
 * Per-field scored breakdown for the PUBLIC shareable report (issue #287) — the
 * honest answer to a competitor's "health score" card.
 *
 * Every field is scored from what the ONE public storefront read actually
 * carried. The load-bearing invariant: a field the public read didn't return is
 * `state: "unreadable"` with a `null` score — NEVER a fabricated 0. We score the
 * ranking/conversion surfaces a logged-out visitor can see (title, subtitle,
 * description, screenshots, ratings, freshness); the deeper keyed audit + the
 * fix are what signing up / installing the plugin unlocks.
 *
 * Pure: takes the agent's `Audit`, returns the breakdown. No DB, no network.
 */
import type { Audit } from "./agent.js";
import { CHAR_LIMITS } from "./constants.js";

export type ReportField = "title" | "subtitle" | "description" | "screenshots" | "ratings" | "freshness";

export type ReportFieldScore = {
  field: ReportField;
  /** the max points this field contributes to the composite. */
  max: number;
  /** measured points, or null when the public read couldn't see this field. */
  score: number | null;
  /** "measured" = we read it; "unreadable" = absent from the public page (not a 0). */
  state: "measured" | "unreadable";
  /** a short, honest reason — what we saw and why the score. */
  note: string;
};

/** Clamp to [0, max] so a score never over/under-runs its budget. */
const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, Math.round(n)));

/** Screenshot letter grade → points out of `max` (null grade "?" = unreadable). */
function gradePoints(grade: string | null | undefined, max: number): number | null {
  if (!grade || grade === "?") return null;
  const table: Record<string, number> = { A: 1, B: 0.82, C: 0.6, D: 0.4, F: 0.15 };
  const frac = table[grade.toUpperCase()];
  return frac === undefined ? null : clamp(frac * max, max);
}

/**
 * A length-fit score: rewards using the field's char budget well without going
 * over. Empty → 0 points (but still measured — we DID read it as empty).
 */
function fitScore(text: string, limit: number, max: number): number {
  const len = text.trim().length;
  if (len === 0) return 0;
  if (len > limit) return clamp(0.7 * max, max); // over limit — will be trimmed
  // reward 55–100% fill; a very short field under-uses the budget.
  const fill = len / limit;
  const frac = fill >= 0.55 ? 1 : 0.5 + fill; // 0.55→1.0, small→~0.5+
  return clamp(frac * max, max);
}

export function buildReportBreakdown(a: Audit): ReportFieldScore[] {
  const out: ReportFieldScore[] = [];

  // ── Title (live name, ≤30) — always present ────────────────────────────────
  const name = a.liveName ?? "";
  out.push({
    field: "title",
    max: 25,
    score: fitScore(name, CHAR_LIMITS.name, 25),
    state: "measured",
    note: name.trim()
      ? `${name.trim().length}/${CHAR_LIMITS.name} chars used.`
      : "No title read from the listing.",
  });

  // ── Subtitle (≤30) — public-page read; absent = unreadable, never a 0 ───────
  if (a.liveSubtitle === undefined) {
    out.push({ field: "subtitle", max: 15, score: null, state: "unreadable", note: "Subtitle wasn’t readable from the public page." });
  } else {
    out.push({
      field: "subtitle",
      max: 15,
      score: fitScore(a.liveSubtitle, CHAR_LIMITS.subtitle, 15),
      state: "measured",
      note: a.liveSubtitle.trim()
        ? `${a.liveSubtitle.trim().length}/${CHAR_LIMITS.subtitle} chars — a second keyword surface.`
        : "Subtitle is empty — a wasted keyword surface.",
    });
  }

  // ── Description — present when iTunes returned one ──────────────────────────
  const desc = a.liveDescription;
  if (desc === undefined) {
    out.push({ field: "description", max: 15, score: null, state: "unreadable", note: "Description wasn’t readable." });
  } else {
    const len = desc.trim().length;
    out.push({
      field: "description",
      max: 15,
      score: clamp(len >= 700 ? 15 : (len / 700) * 15, 15),
      state: "measured",
      note: len >= 700 ? "Substantial, keyword-rich description." : `Short description (${len} chars) — the first lines are prime real estate.`,
    });
  }

  // ── Screenshots — from the grade; "?" = unreadable ──────────────────────────
  const grade = a.screenshots?.grade ?? null;
  const shotScore = gradePoints(grade, 20);
  out.push({
    field: "screenshots",
    max: 20,
    score: shotScore,
    state: shotScore === null ? "unreadable" : "measured",
    note: shotScore === null ? "Screenshots weren’t readable from public data." : `Screenshot set graded ${grade}.`,
  });

  // ── Ratings — from the public storefront read ───────────────────────────────
  const ratings = a.storefront?.ratings;
  if (!ratings) {
    out.push({ field: "ratings", max: 15, score: null, state: "unreadable", note: "Ratings weren’t readable from the public page." });
  } else {
    const { average, count } = ratings;
    // few reviews → honest low score + note, never inflated by a high average.
    const lowSample = count < 50;
    const base = (average / 5) * 15;
    out.push({
      field: "ratings",
      max: 15,
      score: clamp(lowSample ? Math.min(base, 5) : base, 15),
      state: "measured",
      note: lowSample
        ? `${average.toFixed(1)}★ but only ${count} rating${count === 1 ? "" : "s"} — too few to carry weight yet.`
        : `${average.toFixed(1)}★ across ${count.toLocaleString()} ratings.`,
    });
  }

  // ── Freshness — from What's New presence ────────────────────────────────────
  const whatsNew = a.storefront?.whatsNew;
  if (a.storefront === undefined) {
    out.push({ field: "freshness", max: 10, score: null, state: "unreadable", note: "Update recency wasn’t readable." });
  } else {
    const fresh = !!whatsNew && whatsNew.trim().length > 0;
    out.push({
      field: "freshness",
      max: 10,
      score: fresh ? 10 : 4,
      state: "measured",
      note: fresh ? "Actively maintained (has release notes)." : "No recent release notes read.",
    });
  }

  return out;
}
