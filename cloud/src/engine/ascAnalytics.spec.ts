import { describe, expect, it } from "vitest";
import {
  ADMIN_REQUIRED_MESSAGE,
  NOT_REQUESTED_MESSAGE,
  PENDING_MESSAGE,
  UNAVAILABLE_MESSAGE,
  enableAnalyticsReports,
  getAnalyticsStatus,
  pickOngoingRequest,
  type AnalyticsReportRequest,
} from "./ascAnalytics.js";
import type { FetchLike } from "./ascWrite.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: unknown };

/**
 * Fetch stub for the Analytics Reports request lifecycle:
 *   GET  /analyticsReportRequests   → list existing requests for the app
 *   POST /analyticsReportRequests   → create an ONGOING request
 * `list`/`listStatus` drive the GET; `createStatus` drives the POST. Every call
 * is captured so tests can assert the write happened exactly once (or never).
 */
function makeFetch(opts: {
  list?: AnalyticsReportRequest[];
  listStatus?: number;
  createStatus?: number;
  createdId?: string;
}) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.includes("/analyticsReportRequests") && method === "GET") {
      const s = opts.listStatus ?? 200;
      if (s >= 400) return json({ errors: [{ detail: "nope" }] }, s);
      return json({
        data: (opts.list ?? []).map((r) => ({
          id: r.id,
          type: "analyticsReportRequests",
          attributes: {
            accessType: r.accessType,
            stoppedDueToInactivity: r.stoppedDueToInactivity,
          },
        })),
      });
    }
    if (url.includes("/analyticsReportRequests") && method === "POST") {
      const s = opts.createStatus ?? 201;
      if (s >= 400) return json({ errors: [{ detail: "forbidden" }] }, s);
      return json(
        { data: { id: opts.createdId ?? "REQ_NEW", type: "analyticsReportRequests", attributes: { accessType: "ONGOING" } } },
        201,
      );
    }
    return json({}, 404);
  };
  return { fetchFn, calls };
}

const OPTS = { token: "jwt", appId: "1234567" };
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

describe("pickOngoingRequest", () => {
  it("picks an ONGOING request that is not stopped", () => {
    const reqs: AnalyticsReportRequest[] = [
      { id: "A", accessType: "ONE_TIME_SNAPSHOT" },
      { id: "B", accessType: "ONGOING" },
    ];
    expect(pickOngoingRequest(reqs)?.id).toBe("B");
  });
  it("ignores a stopped ONGOING request (Apple stops it after inactivity)", () => {
    const reqs: AnalyticsReportRequest[] = [{ id: "B", accessType: "ONGOING", stoppedDueToInactivity: true }];
    expect(pickOngoingRequest(reqs)).toBeUndefined();
  });
  it("ignores ONE_TIME_SNAPSHOT requests (Phase 1 wants a live ongoing feed)", () => {
    expect(pickOngoingRequest([{ id: "A", accessType: "ONE_TIME_SNAPSHOT" }])).toBeUndefined();
  });
  it("is case-insensitive on accessType", () => {
    expect(pickOngoingRequest([{ id: "B", accessType: "ongoing" }])?.id).toBe("B");
  });
  it("returns undefined for an empty list", () => {
    expect(pickOngoingRequest([])).toBeUndefined();
  });
});

describe("getAnalyticsStatus (read-only — never writes)", () => {
  it("403 from Apple → admin_required, and NEVER attempts a write", async () => {
    const { fetchFn, calls } = makeFetch({ listStatus: 403 });
    const state = await getAnalyticsStatus(fetchFn, OPTS);
    expect(state).toEqual({ state: "admin_required", message: ADMIN_REQUIRED_MESSAGE });
    expect(posts(calls)).toHaveLength(0);
  });

  it("401 from Apple is also treated as an Admin-role gap", async () => {
    const { fetchFn } = makeFetch({ listStatus: 401 });
    expect((await getAnalyticsStatus(fetchFn, OPTS)).state).toBe("admin_required");
  });

  it("a transient 5xx is unavailable — never a fabricated empty/zero state", async () => {
    const { fetchFn } = makeFetch({ listStatus: 503 });
    expect(await getAnalyticsStatus(fetchFn, OPTS)).toEqual({ state: "unavailable", message: UNAVAILABLE_MESSAGE });
  });

  it("permitted but no ongoing request → not_requested", async () => {
    const { fetchFn, calls } = makeFetch({ list: [] });
    expect(await getAnalyticsStatus(fetchFn, OPTS)).toEqual({ state: "not_requested", message: NOT_REQUESTED_MESSAGE });
    expect(posts(calls)).toHaveLength(0); // read-only, even when it could create
  });

  it("permitted with an ongoing request → pending (idempotent, created:false)", async () => {
    const { fetchFn, calls } = makeFetch({ list: [{ id: "REQ1", accessType: "ONGOING" }] });
    expect(await getAnalyticsStatus(fetchFn, OPTS)).toEqual({
      state: "pending",
      message: PENDING_MESSAGE,
      requestId: "REQ1",
      created: false,
    });
    expect(posts(calls)).toHaveLength(0);
  });
});

describe("enableAnalyticsReports (consent-gated write — idempotent)", () => {
  it("no existing request → creates ONE ongoing request and reports pending(created:true)", async () => {
    const { fetchFn, calls } = makeFetch({ list: [], createdId: "REQ_NEW" });
    const state = await enableAnalyticsReports(fetchFn, OPTS);
    expect(state).toEqual({ state: "pending", message: PENDING_MESSAGE, requestId: "REQ_NEW", created: true });

    const writes = posts(calls);
    expect(writes).toHaveLength(1);
    // ONGOING Engagement request, related to the app — never the deprecated Sales & Trends API.
    expect(writes[0]!.url).toContain("/analyticsReportRequests");
    expect(writes[0]!.body).toMatchObject({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: "1234567" } } },
      },
    });
  });

  it("an ongoing request already exists → does NOT create a second (idempotent)", async () => {
    const { fetchFn, calls } = makeFetch({ list: [{ id: "REQ1", accessType: "ONGOING" }] });
    const state = await enableAnalyticsReports(fetchFn, OPTS);
    expect(state).toEqual({ state: "pending", message: PENDING_MESSAGE, requestId: "REQ1", created: false });
    expect(posts(calls)).toHaveLength(0);
  });

  it("non-Admin key → admin_required, and no write is attempted", async () => {
    const { fetchFn, calls } = makeFetch({ listStatus: 403 });
    expect((await enableAnalyticsReports(fetchFn, OPTS)).state).toBe("admin_required");
    expect(posts(calls)).toHaveLength(0);
  });

  it("a 403 on the CREATE itself (list was permissive) still resolves to admin_required", async () => {
    const { fetchFn, calls } = makeFetch({ list: [], createStatus: 403 });
    expect((await enableAnalyticsReports(fetchFn, OPTS)).state).toBe("admin_required");
    expect(posts(calls)).toHaveLength(1); // we tried, Apple refused — disclosed, not papered over
  });

  it("a transient 5xx on create → unavailable (never a false 'requested')", async () => {
    const { fetchFn } = makeFetch({ list: [], createStatus: 502 });
    expect((await enableAnalyticsReports(fetchFn, OPTS)).state).toBe("unavailable");
  });
});
