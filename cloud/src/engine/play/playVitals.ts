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

/** The injected reporting query — resolves the raw response for one metric set,
 *  or throws/rejects (caught here → the rate reads UNMEASURED). */
export type PlayVitalsQuery = (
  metricSet: "crashRateMetricSet" | "anrRateMetricSet",
) => Promise<unknown>;

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
