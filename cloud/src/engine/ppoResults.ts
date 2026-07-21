/**
 * READ-ONLY Product Page Optimization RESULTS reader + honesty surface (#182
 * Phase 4). Phase 2 (ascExperiments.ts) reads experiment STATE; this reads the
 * measured RESULT metrics (impressions / conversion / confidence) — Apple's own
 * A/B numbers, the "measured or absent, never modeled" data our honesty model
 * wants.
 *
 * ROBUST TO BOTH answers to the open question ("are result metrics API-readable,
 * or UI-only?"): when a metrics resource returns numbers we surface them verbatim;
 * when it 403s/404s/returns nothing we degrade to an ASC deep link + the
 * 90-day/confidence guidance. Either way the user gets an honest surface and
 * nothing depends on the metrics endpoint existing.
 *
 * Honesty, load-bearing:
 *   • Apple's numbers verbatim, never ours — conversionRate/confidence are quoted
 *     (labeled Apple's), never computed or restated as a "win",
 *   • a missing metric is ABSENT, never a fabricated 0,
 *   • below the confidence threshold → "running", never an implied outcome,
 *   • no metrics → the deep link, never a fake number; a degraded read is
 *     honestly distinct from "no result yet".
 *
 * SAFETY: GET only. The JWT is per-request via opts.token, never logged,
 * persisted, or returned (mirrors ascExperiments.ts).
 *
 * NEEDS-LIVE-VALIDATION: the exact ASC v2 sub-path + attribute names for
 * treatment result metrics are unverified against a live PPO test. The mapper is
 * written tolerantly so a name mismatch degrades to "no-metrics" (deep link),
 * never a wrong number — verify against a real experiment before relying on the
 * "measured" path in prod.
 */
import { ASC_BASE, ascError, type FetchLike } from "./ascWrite.js";
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";

const SURFACE = "ppo";

/** Apple surfaces statistical significance around 90% confidence. */
export const CONFIDENCE_THRESHOLD = 0.9;

/** One treatment's measured metrics — every field optional; absent ≠ 0. */
export type PpoTreatmentMetrics = {
  treatmentId: string;
  treatmentName?: string;
  impressions?: number;
  /** Apple's conversion rate (0..1), quoted — never computed by us. */
  conversionRate?: number;
  /** Apple's confidence (0..1), verbatim. */
  confidence?: number;
};

export type PpoResult = {
  experimentId: string;
  state?: string;
  /** true when any treatment's Apple confidence reached CONFIDENCE_THRESHOLD. */
  reachedConfidence: boolean;
  treatments: PpoTreatmentMetrics[];
  /** "measured" (numbers + confidence reached) | "running" | "no-metrics". */
  status: "measured" | "running" | "no-metrics";
  /** ASC deep link — the always-present fallback CTA. */
  ascUrl: string;
  /** verbatim 90-day / confidence guidance so nobody reads a result early. */
  guidance: string;
};

export type PpoResultsResult = {
  results: PpoResult[];
  /** true when the metrics endpoint was read (even if empty); false on degrade. */
  read: boolean;
  note?: string | undefined;
};

const GUIDANCE =
  "These are Apple's own Product Page Optimization numbers. Apple recommends " +
  "running a test up to ~90 days and reaching its confidence threshold before " +
  "you read the result — a running test is running, not a win or a loss.";

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** ASC deep link for an experiment (App Store Connect → the app's PPO section). */
export function experimentAscUrl(appId: string, experimentId: string): string {
  return `https://appstoreconnect.apple.com/apps/${encodeURIComponent(appId)}/distribution/ppo/${encodeURIComponent(experimentId)}`;
}

/** ASC JSON:API row → a clean PpoTreatmentMetrics. null when there's no id. */
export function mapTreatmentMetrics(row: unknown): PpoTreatmentMetrics | null {
  const r = (row ?? {}) as { id?: unknown; attributes?: Record<string, unknown> };
  const id = str(r.id);
  if (!id) return null;
  const a = r.attributes ?? {};
  const m: PpoTreatmentMetrics = { treatmentId: id };
  const name = str(a.name);
  const impressions = num(a.impressions);
  const conversionRate = num(a.conversionRate);
  const confidence = num(a.confidence);
  if (name !== undefined) m.treatmentName = name;
  if (impressions !== undefined) m.impressions = impressions;
  if (conversionRate !== undefined) m.conversionRate = conversionRate;
  if (confidence !== undefined) m.confidence = confidence;
  return m;
}

/**
 * Fold an experiment + its treatment metrics into an honest PpoResult. No metric
 * at all → "no-metrics" + the deep link. Metrics present but no treatment reached
 * the confidence threshold → "running". Otherwise "measured". Never fabricates a
 * number; the deep link + guidance are always present.
 */
export function buildPpoResult(args: {
  experimentId: string;
  state?: string;
  appId: string;
  treatments: PpoTreatmentMetrics[];
}): PpoResult {
  const hasAnyMetric = args.treatments.some(
    (t) => t.conversionRate !== undefined || t.impressions !== undefined || t.confidence !== undefined,
  );
  const reachedConfidence = args.treatments.some((t) => t.confidence !== undefined && t.confidence >= CONFIDENCE_THRESHOLD);
  const status: PpoResult["status"] = !hasAnyMetric ? "no-metrics" : reachedConfidence ? "measured" : "running";
  return {
    experimentId: args.experimentId,
    ...(args.state !== undefined ? { state: args.state } : {}),
    reachedConfidence,
    treatments: args.treatments,
    status,
    ascUrl: experimentAscUrl(args.appId, args.experimentId),
    guidance: GUIDANCE,
  };
}

/**
 * Read each experiment's treatment result metrics. DEGRADE-SAFE: any non-OK
 * (403/404/empty) folds that experiment to a "no-metrics" result (deep link +
 * guidance) and never throws — mirrors readAscExperiments. Returns read:false +
 * a token-free note when the reads degraded.
 */
export async function readPpoResults(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; experiments: Array<{ id: string; state?: string }> },
): Promise<PpoResultsResult> {
  const auth = { authorization: `Bearer ${opts.token}` };
  const results: PpoResult[] = [];
  let anyRead = false;
  let note: string | undefined;

  for (const exp of opts.experiments) {
    let treatments: PpoTreatmentMetrics[] = [];
    try {
      // NEEDS-LIVE-VALIDATION: sub-path/attribute names unverified vs a live test.
      const res = await fetchFn(
        `${ASC_BASE}/appStoreVersionExperimentsV2/${encodeURIComponent(exp.id)}/appStoreVersionExperimentTreatments?limit=10`,
        { headers: auth },
      );
      if (res.ok) {
        anyRead = true;
        const body = (await res.json().catch(() => ({}))) as { data?: unknown[] };
        treatments = (body.data ?? []).map(mapTreatmentMetrics).filter((t): t is PpoTreatmentMetrics => t !== null);
      } else {
        const err = await ascError(res, "read product page experiment results");
        note = err.message;
      }
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
    }
    results.push(buildPpoResult({ experimentId: exp.id, appId: opts.appId, treatments, ...(exp.state !== undefined ? { state: exp.state } : {}) }));
  }

  return { results, read: anyRead, ...(note !== undefined ? { note } : {}) };
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/**
 * Turn PPO results into findings — the honesty surface. A `measured` result QUOTES
 * Apple's conversion rate + confidence VERBATIM, explicitly labeled as Apple's own
 * numbers (never restated as our win). A `running` / `no-metrics` result carries
 * the guidance + the ASC deep link and NO fabricated metric. Rides the existing
 * findings card (the `Finding` shape).
 */
export function ppoResultFindings(results: PpoResult[]): Finding[] {
  const out: Finding[] = [];
  for (const r of results) {
    if (r.status === "measured") {
      // the treatment with the highest (Apple) confidence is the headline.
      const best = [...r.treatments]
        .filter((t) => t.conversionRate !== undefined)
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      const named = best?.treatmentName ? `“${best.treatmentName}” ` : "";
      const rate = best?.conversionRate !== undefined ? pct(best.conversionRate) : "its measured rate";
      const conf = best?.confidence !== undefined ? pct(best.confidence) : "its reported confidence";
      out.push(
        mk({
          id: "ppo_result_measured",
          surface: SURFACE,
          severity: "info",
          impact: "conversion",
          title: "Apple measured a result on your product page test",
          detail:
            `Apple's Product Page Optimization measured ${named}at ${rate} conversion, at ${conf} confidence — ` +
            `these are Apple's own numbers, not ours. ${GUIDANCE}`,
          fix: "Review the full result in App Store Connect before applying the treatment.",
          evidence: r.ascUrl,
          context: true,
        }),
      );
    } else {
      out.push(
        mk({
          id: r.status === "running" ? "ppo_result_running" : "ppo_result_no_metrics",
          surface: SURFACE,
          severity: "info",
          impact: "conversion",
          title:
            r.status === "running"
              ? "Your product page test is still gathering confidence"
              : "View your product page test result in App Store Connect",
          detail:
            r.status === "running"
              ? `This test hasn't reached Apple's confidence threshold yet. ${GUIDANCE}`
              : `We couldn't read this test's metrics via the API — open it in App Store Connect for the numbers. ${GUIDANCE}`,
          fix: "Open the experiment in App Store Connect to read Apple's full result.",
          evidence: r.ascUrl,
          context: true,
        }),
      );
    }
  }
  return out;
}
