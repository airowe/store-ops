/**
 * App Store Connect Analytics Reports — Phase 1: request lifecycle + Admin
 * detection + honest empty state (analytics-reports PRD, 01-request-lifecycle).
 *
 * The Analytics Reports API is the OUTCOME side of the audit (impressions,
 * product-page views, conversion, downloads). Phase 1 ships NONE of those
 * numbers — it only establishes the async request that Apple takes ~1–2 days to
 * first generate, and detects honestly whether the user's key is even allowed to
 * ask. Ingestion + parsing + metrics are Phases 2/3.
 *
 * Two hard properties shape this module (see 00-overview.md):
 *   1. Report *requests* need an ADMIN-role key. The audit's App-Manager key may
 *      get a 403 — which must become an honest "needs Admin" state, never a
 *      failed or slowed audit.
 *   2. The request is ASYNCHRONOUS. Creating it does NOT return data; Apple
 *      generates instances over ~1–2 days. So the only honest post-create state
 *      is "requested — check back", never "0 views".
 *
 * Pure by construction: no bindings, fetch injected (same shape as ascRead.ts /
 * ascWrite.ts). The short-lived JWT is the only credential touched; the `.p8`
 * never reaches this module and no token is ever logged or returned.
 *
 * Targets the Analytics Reports API (`analyticsReportRequests`) ONLY — never the
 * deprecated Sales & Trends API.
 */
import { ASC_BASE, type FetchLike } from "./ascWrite.js";

// ── Honest, measured-or-absent copy. Centralised so the surface can never drift
//    into a fabricated number. Every string is disclosure, not a metric. ───────
export const ADMIN_REQUIRED_MESSAGE =
  "Your App Store Connect key needs the Admin role to read analytics reports. Your audit still works — this only gates measured conversion data.";
export const UNAVAILABLE_MESSAGE =
  "Couldn’t reach App Store Connect analytics right now. Nothing was changed — try again shortly.";
export const NOT_REQUESTED_MESSAGE =
  "Analytics reporting isn’t set up yet. Enable it to have Apple start generating your Engagement reports (about 1–2 days).";
export const PENDING_MESSAGE =
  "Analytics requested — Apple generates the first report in about 1–2 days. Check back then; nothing to show yet.";

/** An analyticsReportRequest as we consume it — only the fields Phase 1 needs. */
export type AnalyticsReportRequest = {
  id: string;
  /** "ONGOING" | "ONE_TIME_SNAPSHOT". Phase 1 wants a live ONGOING feed. */
  accessType?: string | undefined;
  /** Apple stops an ONGOING request after prolonged inactivity — then it's dead. */
  stoppedDueToInactivity?: boolean | undefined;
};

/**
 * The honest Phase-1 surface state. No variant carries a metric — Phase 1 has no
 * data. `pending` names the async wait; `admin_required` discloses the role gap;
 * `unavailable` is a transient reach failure (never a false "requested"/"zero").
 */
export type AnalyticsState =
  | { state: "admin_required"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "not_requested"; message: string }
  | { state: "pending"; message: string; requestId: string; created: boolean };

const adminRequired = (): AnalyticsState => ({ state: "admin_required", message: ADMIN_REQUIRED_MESSAGE });
const unavailable = (): AnalyticsState => ({ state: "unavailable", message: UNAVAILABLE_MESSAGE });
const notRequested = (): AnalyticsState => ({ state: "not_requested", message: NOT_REQUESTED_MESSAGE });
const pending = (requestId: string, created: boolean): AnalyticsState => ({
  state: "pending",
  message: PENDING_MESSAGE,
  requestId,
  created,
});

/**
 * Pick the live ONGOING request from a list, if any: accessType ONGOING and not
 * stopped. Pure — the idempotency check ("does a request already exist?") that
 * keeps enable from ever creating a second one. A ONE_TIME_SNAPSHOT or a stopped
 * request does not count as a live ongoing feed.
 */
export function pickOngoingRequest(
  requests: readonly AnalyticsReportRequest[],
): AnalyticsReportRequest | undefined {
  return requests.find(
    (r) => (r.accessType ?? "").toUpperCase() === "ONGOING" && r.stoppedDueToInactivity !== true,
  );
}

/** A 401/403 is a role/permission gap; any other non-OK is a transient reach failure. */
type Probe =
  | { ok: true; requests: AnalyticsReportRequest[] }
  | { ok: false; kind: "admin_required" | "unavailable" };

const classify = (status: number): "admin_required" | "unavailable" =>
  status === 401 || status === 403 ? "admin_required" : "unavailable";

/**
 * READ-ONLY probe: list the app's analyticsReportRequests. 200 → permitted (with
 * the parsed list, possibly empty); 401/403 → the key can't read analytics
 * (Admin gap); any other non-OK → unavailable. Never throws — the audit must
 * never fail or slow because analytics was unreachable.
 */
async function probeAnalyticsAccess(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<Probe> {
  let res: Response;
  try {
    res = await fetchFn(
      `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/analyticsReportRequests?limit=200`,
      { headers: { authorization: `Bearer ${opts.token}` } },
    );
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (!res.ok) return { ok: false, kind: classify(res.status) };

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id: string; attributes?: { accessType?: string; stoppedDueToInactivity?: boolean } }>;
  };
  const requests: AnalyticsReportRequest[] = (body.data ?? []).map((r) => ({
    id: r.id,
    accessType: r.attributes?.accessType,
    stoppedDueToInactivity: r.attributes?.stoppedDueToInactivity,
  }));
  return { ok: true, requests };
}

/** Result of the CREATE write: the new id, or the same honest failure kinds. */
type CreateResult =
  | { ok: true; id: string }
  | { ok: false; kind: "admin_required" | "unavailable" };

/**
 * Create an ONGOING analyticsReportRequest for the app — an OUTWARD WRITE to the
 * user's App Store Connect account. Only ever called from the consent-gated
 * enable path, never automatically. Engagement is a REPORT category filtered at
 * ingest (Phase 2); the request itself is app-scoped and ONGOING.
 */
async function createAnalyticsReportRequest(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetchFn(`${ASC_BASE}/analyticsReportRequests`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          type: "analyticsReportRequests",
          attributes: { accessType: "ONGOING" },
          relationships: { app: { data: { type: "apps", id: opts.appId } } },
        },
      }),
    });
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (!res.ok) return { ok: false, kind: classify(res.status) };
  const body = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  const id = body.data?.id;
  if (!id) return { ok: false, kind: "unavailable" };
  return { ok: true, id };
}

/**
 * READ-ONLY status for the app's analytics reporting. Detects the Admin gap and
 * reports whether an ongoing request already exists — WITHOUT ever creating one.
 * This backs the "here's the state" surface the user sees before consenting.
 */
export async function getAnalyticsStatus(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AnalyticsState> {
  const probe = await probeAnalyticsAccess(fetchFn, opts);
  if (!probe.ok) return probe.kind === "admin_required" ? adminRequired() : unavailable();
  const ongoing = pickOngoingRequest(probe.requests);
  return ongoing ? pending(ongoing.id, false) : notRequested();
}

/**
 * CONSENT-GATED write: ensure exactly ONE ongoing request exists for the app,
 * idempotently. If one already exists we return it (created:false) and never
 * write again; otherwise we create it (created:true). A role gap or transient
 * failure surfaces honestly and no false "requested" is ever returned.
 *
 * Callers MUST gate this behind an explicit user action (its own endpoint + UI
 * click) — creating the request is a write to the user's Apple account.
 */
export async function enableAnalyticsReports(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AnalyticsState> {
  const probe = await probeAnalyticsAccess(fetchFn, opts);
  if (!probe.ok) return probe.kind === "admin_required" ? adminRequired() : unavailable();

  const existing = pickOngoingRequest(probe.requests);
  if (existing) return pending(existing.id, false); // idempotent — never a second request

  const created = await createAnalyticsReportRequest(fetchFn, opts);
  if (!created.ok) return created.kind === "admin_required" ? adminRequired() : unavailable();
  return pending(created.id, true);
}
