/**
 * Measured conversion + conversion-movement (analytics-reports PRD Phase 3).
 *
 * This is where the honesty model finally shows a MEASURED conversion number
 * instead of "—". It joins the persisted Engagement series (Phase 2) to the
 * app's own APPROVED pushes (the same approval-stamped markers rankAnnotations
 * uses) and reports how conversion moved around each ship.
 *
 * HONESTY LIMITS (rendered verbatim by the UI):
 *   • conversion is a MEASURED ratio — downloads / product-page-views from
 *     Apple's report — never modeled; when PPV is 0 it is `null` (unmeasured),
 *     never a fabricated 0,
 *   • movement is CORRELATIONAL ("after you shipped, conversion moved") — never
 *     a causal claim (same posture as rankAnnotations.ts / rankAttribution.ts),
 *   • measured-or-absent: a movement is emitted ONLY when BOTH the before and
 *     after windows have a measurable conversion; a one-sided window yields
 *     nothing, never a half-invented delta.
 *
 * Pure + deterministic: same input → identical output. No fetch, no Date.now
 * (date-window math uses fixed-string parsing, not the wall clock).
 */

/** One row of the persisted series, narrowed to what conversion needs. Structurally
 *  compatible with d1's EngagementSeriesRow (metrics NULL when unmeasured). */
export type ConversionRow = {
  date: string;
  source?: string | null;
  productPageViews: number | null;
  downloads: number | null;
};

/** An approval-stamped push (derivePushes output — the ship we measure around). */
export type PushMarker = { runId?: string; pushedAt: string };

export type ConversionMovement = {
  /** the push date (YYYY-MM-DD). */
  at: string;
  runId?: string | undefined;
  /** "" = all sources (the aggregate); otherwise a specific traffic source. */
  source: string;
  /** measured conversion fraction (0..1) in the before / after window. */
  before: number;
  after: number;
  /** after − before (fraction). Descriptive, not causal. */
  delta: number;
  /** measured days that contributed to each side. */
  samplesBefore: number;
  samplesAfter: number;
};

const DAY_MS = 86_400_000;
/** Ordinal day number for a YYYY-MM-DD(...) string. Deterministic (no Date.now). */
const dayNum = (d: string): number => Math.floor(Date.parse(d.slice(0, 10) + "T00:00:00Z") / DAY_MS);

/** MEASURED conversion = downloads / product-page-views. Null (unmeasured) when a
 *  side wasn't measured or PPV is 0 — never 0/0, never a fabricated 0. */
export function conversionRate(productPageViews: number | null, downloads: number | null): number | null {
  if (productPageViews == null || downloads == null || productPageViews <= 0) return null;
  return downloads / productPageViews;
}

/** Pool PPV + downloads over a half-open day window [lo, hi), optionally for one
 *  source, then divide. Returns the measured rate (or null) + the count of days
 *  that carried data. */
function pooledRate(
  rows: ConversionRow[],
  lo: number,
  hi: number,
  sourceFilter: string | undefined,
): { rate: number | null; days: number } {
  let ppv = 0;
  let dl = 0;
  let sawPpv = false;
  let sawDl = false;
  const dates = new Set<string>();
  for (const r of rows) {
    const dn = dayNum(r.date);
    if (dn < lo || dn >= hi) continue;
    if (sourceFilter !== undefined && (r.source ?? "") !== sourceFilter) continue;
    dates.add(r.date);
    if (r.productPageViews != null) { ppv += r.productPageViews; sawPpv = true; }
    if (r.downloads != null) { dl += r.downloads; sawDl = true; }
  }
  const rate = sawPpv && sawDl && ppv > 0 ? dl / ppv : null;
  return { rate, days: dates.size };
}

/** The most recent day's MEASURED overall conversion (aggregated across sources),
 *  or null when the series is empty or that day isn't measurable. Replaces "—". */
export function latestConversion(rows: ConversionRow[]): { date: string; rate: number } | null {
  if (rows.length === 0) return null;
  const latest = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0]!.date);
  const { rate } = pooledRate(rows, dayNum(latest), dayNum(latest) + 1, undefined);
  return rate == null ? null : { date: latest, rate };
}

/**
 * For each push, measure conversion in the `windowDays` before vs from the push,
 * as an aggregate ("" source) and per traffic source. Emits a movement only when
 * BOTH sides are measurable (correlational, measured-or-absent). Never throws.
 */
export function conversionMovements(
  rows: ConversionRow[],
  pushes: PushMarker[],
  opts: { windowDays?: number } = {},
): ConversionMovement[] {
  const w = opts.windowDays ?? 14;
  const out: ConversionMovement[] = [];

  for (const push of pushes) {
    const day = push.pushedAt.slice(0, 10);
    const pd = dayNum(day);

    // sources present in either window (non-empty only; empty feeds the aggregate).
    const sources = new Set<string>();
    for (const r of rows) {
      const dn = dayNum(r.date);
      if (dn >= pd - w && dn < pd + w) {
        const s = r.source ?? "";
        if (s) sources.add(s);
      }
    }

    // Aggregate first, then each source. `undefined` filter = all sources.
    for (const filter of [undefined, ...sources] as (string | undefined)[]) {
      const before = pooledRate(rows, pd - w, pd, filter);
      const after = pooledRate(rows, pd, pd + w, filter);
      if (before.rate == null || after.rate == null) continue; // one-sided → no claim
      out.push({
        at: day,
        runId: push.runId,
        source: filter ?? "",
        before: before.rate,
        after: after.rate,
        delta: after.rate - before.rate,
        samplesBefore: before.days,
        samplesAfter: after.days,
      });
    }
  }
  return out;
}
