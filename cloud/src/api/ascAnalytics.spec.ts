/**
 * ASC Analytics Reports Phase 1 routes (analytics-reports PRD, 01) — driven
 * through the real `handleApi` router. The egress (Apple's API) is stubbed on
 * the global `fetch` the routes use; auth is the demo `x-user-email` path and
 * the app is owned by that user via the fake DB. In-request creds are supplied
 * (a real ES256 key), so `mintAscJwt` runs for real; only Apple is faked.
 *
 * Asserts the route glue the engine spec can't: the consent gate on `enable`
 * (403 + zero egress when ANALYTICS_ENABLED is unset), that `status` is
 * read-only + ungated, and that a permitted `enable` creates exactly one request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

// A real PKCS#8 EC P-256 key so mintAscJwt signs for real (shared with asaConnect).
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;
const CREDS = { p8: TEST_KEY, keyId: "KID", issuerId: "ISS" };

/** Fake DB: demo auth (users by email/id) + an app always owned by the test user. */
function fakeDb(): D1Database {
  const users = new Map<string, { id: string; email: string }>();
  let lastUserId = "";
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE email = \?/.test(s)) return (users.get(String(bound[0])) ?? null) as T | null;
        if (/FROM users WHERE id = \?/.test(s)) return ([...users.values()].find((u) => u.id === bound[0]) ?? null) as T | null;
        if (/FROM apps WHERE id = \?/.test(s)) {
          return { id: String(bound[0]), user_id: lastUserId, bundle_id: "com.test.app", name: "T", country: "US", created_at: "2026-01-01" } as T;
        }
        return null as T | null;
      },
      async run() {
        if (/^INSERT INTO users/.test(s)) { lastUserId = String(bound[0]); users.set(String(bound[1]), { id: String(bound[0]), email: String(bound[1]) }); }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() { return { results: [] as T[] }; },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { DB: fakeDb(), DEFAULT_COUNTRY: "US", APP_ENV: "demo", ...overrides } as Env;
}

function req(path: string, body: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-email": "owner@example.com" },
    body: JSON.stringify(body),
  });
}

/** Stub global fetch: app-id lookup + the analyticsReportRequests list/create. */
function stubApple(opts: { list?: unknown[]; listStatus?: number; createStatus?: number }) {
  const calls: { url: string; method: string }[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: u, method });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u.includes("filter[bundleId]")) return json({ data: [{ id: "9999" }] }); // findAscAppId
    if (u.includes("/analyticsReportRequests") && method === "GET") {
      const st = opts.listStatus ?? 200;
      return st >= 400 ? json({ errors: [] }, st) : json({ data: (opts.list ?? []).map((a) => ({ id: "R1", type: "analyticsReportRequests", attributes: a })) });
    }
    if (u.includes("/analyticsReportRequests") && method === "POST") {
      const st = opts.createStatus ?? 201;
      return st >= 400 ? json({ errors: [] }, st) : json({ data: { id: "R_NEW", attributes: { accessType: "ONGOING" } } }, 201);
    }
    return json({}, 404);
  });
  vi.stubGlobal("fetch", impl);
  return { calls, impl };
}

afterEach(() => vi.unstubAllGlobals());

describe("ASC Analytics Phase 1 routes", () => {
  it("enable is consent-gated: 403 with ZERO egress when ANALYTICS_ENABLED is unset", async () => {
    const { impl } = stubApple({});
    const res = await handleApi(req("/apps/app1/analytics/enable", CREDS), makeEnv());
    expect(res.status).toBe(403);
    expect(impl).not.toHaveBeenCalled(); // gate is the first line — nothing reaches Apple
  });

  it("enable (flag on), no existing request → creates ONE ongoing request, reports pending(created)", async () => {
    const { calls } = stubApple({ list: [] });
    const res = await handleApi(req("/apps/app1/analytics/enable", CREDS), makeEnv({ ANALYTICS_ENABLED: "1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "pending", created: true, requestId: "R_NEW" });
    expect(calls.filter((c) => c.url.includes("/analyticsReportRequests") && c.method === "POST")).toHaveLength(1);
  });

  it("status is read-only + ungated: a non-Admin key → admin_required, no write, no flag needed", async () => {
    const { calls } = stubApple({ listStatus: 403 });
    const res = await handleApi(req("/apps/app1/analytics/status", CREDS), makeEnv()); // flag intentionally unset
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "admin_required" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});
