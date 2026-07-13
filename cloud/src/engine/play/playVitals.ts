/**
 * Android vitals — the one Google-DOCUMENTED Play ranking/visibility lever, and
 * the marquee signal with no App Store equivalent (data-map §0.4). Google states
 * that exceeding a technical-quality "bad behavior threshold" means "Play may
 * reduce the visibility of your title" AND show users a warning on the store
 * listing (developer.android.com/topic/performance/vitals). So a listing can be
 * metadata-perfect and still be suppressed by crashes/ANRs — a real, cited audit
 * finding the rest of the audit can't see.
 *
 * Owner-keyed: the numbers come from the Play Developer Reporting API
 * (playdeveloperreporting), read with the app's own service account. The concrete
 * query is INJECTED (`PlayVitalsQuery`) so this module stays pure + testable and
 * the transport/scope plumbing lives in the API layer.
 *
 * Honesty, load-bearing:
 *   • a rate we couldn't read is `null` (UNMEASURED) — never a fabricated 0,
 *   • the finding fires only on a MEASURED rate over a VERIFIED Google threshold,
 *   • the finding cites Google's page + the exact threshold, and is stated as
 *     Google's documented behavior, not our opinion,
 *   • degrade-safe by construction: any read failure → nulls, never throws into
 *     the audit.
 *
 * ⚠️ The Reporting API request/response SHAPE is not exercised here against a live
 * account, so the live read is GATED (`PLAY_VITALS_ENABLED`) — same discipline as
 * the ASA popularity reader. The threshold/finding logic below is exact + tested.
 */
import { type Finding, mk } from "../findings/core.js";

/** VERIFIED bad-behavior thresholds (user-perceived, 28-day), as a PERCENT.
 *  Source: developer.android.com/topic/performance/vitals. */
export const PLAY_CRASH_THRESHOLD_PCT = 1.09;
export const PLAY_ANR_THRESHOLD_PCT = 0.47;
export const PLAY_VITALS_SOURCE = "https://developer.android.com/topic/performance/vitals";

/** Measured user-perceived rates as a PERCENT, or null when unread. */
export type PlayVitals = {
  crashRatePct: number | null;
  anrRatePct: number | null;
};

/** The injected reporting query — resolves the raw response for one metric set
 *  (by its Reporting API `:query` resource name, e.g. `crashRateMetricSet`), or
 *  throws/rejects (caught here → the rate reads UNMEASURED). Widened to `string`
 *  so the same seam serves the crash/ANR sets AND the newer quality sets below. */
export type PlayVitalsQuery = (metricSet: string) => Promise<unknown>;

/** Candidate metric field names, preferring the user-perceived variant. */
const CRASH_METRICS = ["userPerceivedCrashRate", "crashRate"];
const ANR_METRICS = ["userPerceivedAnrRate", "anrRate"];

/** Read a numeric value off a Reporting `MetricValue` (decimalValue.value | number). */
function numericValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const dv = (v as { decimalValue?: { value?: unknown }; doubleValue?: unknown });
    const raw = dv.decimalValue?.value ?? dv.doubleValue;
    const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Tolerantly pull the LATEST value for one of `names` out of a Reporting query
 * response. Defensive against shape drift: walks `rows[].metrics[]`, matches a
 * metric by name, reads its value, and returns the last (latest) match as a
 * PERCENT. The API returns a fraction (0.0109 = 1.09%), so we ×100. null when
 * nothing matched.
 */
export function extractLatestRatePct(resp: unknown, names: string[]): number | null {
  const rows = (resp as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return null;
  let latest: number | null = null;
  for (const row of rows) {
    const metrics = (row as { metrics?: unknown })?.metrics;
    if (!Array.isArray(metrics)) continue;
    for (const m of metrics) {
      const name = (m as { metric?: unknown })?.metric;
      if (typeof name === "string" && names.includes(name)) {
        const val = numericValue((m as { value?: unknown }).value ?? m);
        if (val !== null) latest = val * 100; // fraction → percent
      }
    }
  }
  return latest;
}

/**
 * Read the app's user-perceived crash + ANR rates via the injected query.
 * Degrade-safe: each metric independently degrades to `null` on any failure, so
 * a missing scope / empty account / drifted shape yields UNMEASURED, never a
 * throw and never a fake 0.
 */
export async function readPlayVitals(query: PlayVitalsQuery): Promise<PlayVitals> {
  const one = async (set: "crashRateMetricSet" | "anrRateMetricSet", names: string[]) => {
    try {
      return extractLatestRatePct(await query(set), names);
    } catch {
      return null;
    }
  };
  const [crashRatePct, anrRatePct] = await Promise.all([
    one("crashRateMetricSet", CRASH_METRICS),
    one("anrRateMetricSet", ANR_METRICS),
  ]);
  return { crashRatePct, anrRatePct };
}

const SURFACE = "vitals";
function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}
function overThresholdFinding(
  id: string,
  label: string,
  rate: number,
  threshold: number,
): Finding {
  return mk({
    id,
    surface: SURFACE,
    severity: "critical",
    impact: "ranking",
    title: `${label} (${pct(rate)}) exceeds Google's ${pct(threshold)} threshold`,
    detail:
      `Google documents that exceeding a technical-quality threshold means Play "may reduce the visibility of your title" and may show users a warning on your store listing — so this suppresses discovery regardless of your metadata.`,
    fix: `Bring the ${label.toLowerCase()} back under ${pct(threshold)} (Android vitals, 28-day user-perceived).`,
    evidence: `Android vitals — bad-behavior threshold ${pct(threshold)} (${PLAY_VITALS_SOURCE})`,
  });
}

/**
 * Findings from measured vitals. A rate OVER its Google threshold is a critical
 * visibility risk (cited). When BOTH rates are measured AND under threshold, one
 * honest "healthy" info finding. Unmeasured rates contribute nothing. Pure.
 */
export function playVitalsFindings(vitals: PlayVitals): Finding[] {
  const out: Finding[] = [];
  const { crashRatePct, anrRatePct } = vitals;
  if (crashRatePct !== null && crashRatePct > PLAY_CRASH_THRESHOLD_PCT) {
    out.push(
      overThresholdFinding("play_vitals_crash_over", "Crash rate", crashRatePct, PLAY_CRASH_THRESHOLD_PCT),
    );
  }
  if (anrRatePct !== null && anrRatePct > PLAY_ANR_THRESHOLD_PCT) {
    out.push(
      overThresholdFinding("play_vitals_anr_over", "ANR rate", anrRatePct, PLAY_ANR_THRESHOLD_PCT),
    );
  }
  // Both measured and under threshold → a single positive, honest fact.
  if (
    out.length === 0 &&
    crashRatePct !== null &&
    anrRatePct !== null &&
    crashRatePct <= PLAY_CRASH_THRESHOLD_PCT &&
    anrRatePct <= PLAY_ANR_THRESHOLD_PCT
  ) {
    out.push(
      mk({
        id: "play_vitals_healthy",
        surface: SURFACE,
        severity: "good",
        impact: "ranking",
        title: `Android vitals are under Google's thresholds`,
        detail: `Crash ${pct(crashRatePct)} (< ${pct(PLAY_CRASH_THRESHOLD_PCT)}) and ANR ${pct(anrRatePct)} (< ${pct(PLAY_ANR_THRESHOLD_PCT)}) — no visibility penalty from technical quality.`,
        fix: "",
        evidence: `Android vitals (${PLAY_VITALS_SOURCE})`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quality metric sets (new-since-2023 vitals — data-map §3.2 refresh).
//
// The Reporting API now exposes four MORE Google-measured "bad behaviour"
// quality sets. Crucially, unlike crash/ANR, Google does NOT document that
// these gate store VISIBILITY — so we surface them as measured technical-quality
// CONTEXT (impact:"conversion"), never as a ranking claim. Honest split.
//
// Every set is read through the SAME injected `PlayVitalsQuery` seam. Live shape
// is best-effort (metric field names vary), so each set carries CANDIDATE metric
// names and the whole path stays gated + degrade-safe (unread rate → null).
// ---------------------------------------------------------------------------

/** A newer quality metric set: its `:query` resource name + candidate metrics. */
export type PlayQualityMetricSet = {
  /** stable finding id suffix, e.g. "excessive_wakeup" */
  id: string;
  /** Reporting API `:query` resource, e.g. "excessiveWakeupRateMetricSet" */
  metricSet: string;
  /** human label for the finding title */
  label: string;
  /** candidate metric field names (first measured one wins) */
  metrics: string[];
};

/** VERIFIED present in the rev-20260709 Discovery doc (resource names); the exact
 *  metric field names are best-effort candidates, hence the gated path. */
export const PLAY_QUALITY_METRIC_SETS: PlayQualityMetricSet[] = [
  {
    id: "excessive_wakeup",
    metricSet: "excessiveWakeupRateMetricSet",
    label: "Excessive wake-up rate",
    metrics: ["userPerceivedExcessiveWakeupRate", "excessiveWakeupRate"],
  },
  {
    id: "stuck_bg_wakelock",
    metricSet: "stuckBackgroundWakelockRateMetricSet",
    label: "Stuck background-wakelock rate",
    metrics: ["userPerceivedStuckBackgroundWakelockRate", "stuckBgWakelockRate", "stuckBackgroundWakelockRate"],
  },
  {
    id: "slow_rendering",
    metricSet: "slowRenderingRateMetricSet",
    label: "Slow-rendering rate",
    metrics: ["slowRenderingRate20Fps", "slowRenderingRate30Fps", "slowRenderingRate"],
  },
  {
    id: "lmk",
    metricSet: "lmkRateMetricSet",
    label: "Low-memory-kill rate",
    metrics: ["userPerceivedLmkRate", "lmkRate"],
  },
];

/** Measured quality rates keyed by set id (PERCENT), or null when unread. */
export type PlayQualityRates = Record<string, number | null>;

/**
 * Read the four newer quality rates via the injected query. Degrade-safe: each
 * set independently degrades to `null` on any failure (missing scope / drifted
 * shape / empty account) — never a throw, never a fabricated 0.
 */
export async function readPlayQualityRates(
  query: PlayVitalsQuery,
  sets: PlayQualityMetricSet[] = PLAY_QUALITY_METRIC_SETS,
): Promise<PlayQualityRates> {
  const entries = await Promise.all(
    sets.map(async (s) => {
      try {
        return [s.id, extractLatestRatePct(await query(s.metricSet), s.metrics)] as const;
      } catch {
        return [s.id, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Findings from the newer quality rates. Each MEASURED rate becomes one honest
 * CONTEXT fact (impact:"conversion", not "ranking") — Google measures and flags
 * these as poor app behaviour, but does NOT document them as store-visibility
 * gates the way crash/ANR are (§3.2). Unmeasured rates contribute nothing. Pure.
 */
export function playQualityFindings(
  rates: PlayQualityRates,
  sets: PlayQualityMetricSet[] = PLAY_QUALITY_METRIC_SETS,
): Finding[] {
  const out: Finding[] = [];
  for (const s of sets) {
    const rate = rates[s.id];
    if (rate === null || rate === undefined) continue;
    out.push(
      mk({
        id: `play_vitals_${s.id}`,
        surface: SURFACE,
        severity: "info",
        impact: "conversion",
        title: `${s.label}: ${pct(rate)}`,
        detail:
          `A Google-measured Android-vitals quality metric. Google flags it as poor app behaviour; unlike crash/ANR it is not a documented store-visibility gate, so treat it as a technical-quality signal, not a ranking penalty.`,
        fix: `Reduce the ${s.label.toLowerCase()} in your next release (Android vitals, 28-day user-perceived).`,
        evidence: `Android vitals — ${s.metricSet} (${PLAY_VITALS_SOURCE})`,
        context: true,
      }),
    );
  }
  return out;
}
