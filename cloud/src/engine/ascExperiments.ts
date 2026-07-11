/**
 * READ-ONLY App Store Connect Product Page Optimization reader (#182 Phase 2).
 *
 * PPO is Apple's own free A/B test of the default product page. Reading the
 * app's experiments + their state lets the audit surface two honest, MEASURED
 * facts (ppoFindings.ts turns these into findings):
 *   • the app has NEVER run a product page test — and it's free, or
 *   • a test is RUNNING since <startDate> — quote Apple's own dates, and cite
 *     the ~90-day / confidence-threshold guidance so nobody judges it early.
 *
 * The graph is a single GET (v2 experiments hang off the APP, not a version):
 *   GET /apps/{appId}/appStoreVersionExperimentsV2
 *
 * SAFETY: GET only. The JWT is passed per-request via opts.token and is NEVER
 * logged, persisted, or returned. A 403/404 (key without the scope, or an app
 * that has simply never had experiments) degrades to `{ experiments: [] }` —
 * "no test read" is honestly distinct from "never tested" only at the call site,
 * so we DON'T invent a "never tested" fact from a permission failure: a degraded
 * read records a note and the findings layer stays silent (see ppoFindings).
 */
import { ASC_BASE, ascError, type FetchLike } from "./ascWrite.js";

/** One Product Page Optimization experiment, as read from ASC (v2). */
export type PpoExperiment = {
  id: string;
  /** the experiment's name, as the developer set it in ASC. */
  name?: string | undefined;
  /**
   * ASC experiment state, e.g. PREPARE_FOR_SUBMISSION / IN_REVIEW / ACCEPTED /
   * COMPLETED / STOPPED. Quoted verbatim — never our own label.
   */
  state?: string | undefined;
  /** true once the experiment has actually gone live (Apple's `started` flag). */
  started?: boolean | undefined;
  /** ISO start date Apple recorded, quoted verbatim. Absent until it starts. */
  startDate?: string | undefined;
  /** ISO end date, present once Apple has scheduled/recorded an end. */
  endDate?: string | undefined;
  /** treatment traffic percentage (0–100), when ASC exposes it. */
  trafficProportion?: number | undefined;
};

export type AscExperimentsResult = {
  /** every experiment read for the app (any state). Empty when the read degraded. */
  experiments: PpoExperiment[];
  /**
   * true only when the experiments endpoint was READ successfully (even if it
   * returned zero rows). false when the read degraded (403/404/etc.) — the
   * findings layer needs this to tell "never tested" (read OK, zero rows) from
   * "couldn't read" (degraded), and stay silent on the latter (no false fact).
   */
  read: boolean;
  /** token-free note when the read degraded. Absent on a clean read. */
  note?: string | undefined;
};

/** ASC JSON:API row shape — only the attributes we read. */
type ExperimentRow = {
  id?: string;
  attributes?: {
    name?: unknown;
    state?: unknown;
    started?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    trafficProportion?: unknown;
  };
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Map an ASC experiment row → our clean PpoExperiment, dropping absent fields. */
export function mapExperiment(row: ExperimentRow): PpoExperiment {
  const a = row.attributes ?? {};
  const exp: PpoExperiment = { id: String(row.id ?? "") };
  const name = str(a.name);
  const state = str(a.state);
  const started = bool(a.started);
  const startDate = str(a.startDate);
  const endDate = str(a.endDate);
  const trafficProportion = num(a.trafficProportion);
  if (name !== undefined) exp.name = name;
  if (state !== undefined) exp.state = state;
  if (started !== undefined) exp.started = started;
  if (startDate !== undefined) exp.startDate = startDate;
  if (endDate !== undefined) exp.endDate = endDate;
  if (trafficProportion !== undefined) exp.trafficProportion = trafficProportion;
  return exp;
}

/**
 * Read the app's Product Page Optimization experiments (v2). READ-ONLY.
 *
 * Graceful degradation: a 403 (key lacks the scope) or 404 (endpoint/app has no
 * experiments resource) returns `{ experiments: [], read: false, note }` — never
 * throws. That `read:false` is what keeps the findings layer from claiming
 * "never tested" off a permission failure. Any OTHER non-OK is treated the same
 * (degrade + note) so a PPO read never strands the whole run.
 */
export async function readAscExperiments(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AscExperimentsResult> {
  const auth = { authorization: `Bearer ${opts.token}` };
  const res = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersionExperimentsV2?limit=50`,
    { headers: auth },
  );
  if (!res.ok) {
    // Token-free note (mirrors ascError's wording) — but degrade, don't throw.
    const err = await ascError(res, "list product page experiments");
    return { experiments: [], read: false, note: err.message };
  }
  const body = (await res.json().catch(() => ({}))) as { data?: ExperimentRow[] };
  const experiments = (body.data ?? []).map(mapExperiment);
  return { experiments, read: true };
}
