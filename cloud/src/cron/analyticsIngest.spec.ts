/**
 * Daily background analytics ingest (analytics-reports Phase 2 open-Q2). Deps
 * (fetch + gunzip) are injected; only the credential store is mocked so a stored
 * key can be handed back without a KEK/DB. Asserts the gates (flag + KEK + stored
 * key) and that an app with a ready report gets ingested + persisted.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let kekOn = true;
const useCredential = vi.fn();
vi.mock("../credentialStore.js", () => ({
  credentialsEnabled: () => kekOn,
  useCredential: (...a: unknown[]) => useCredential(...a),
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
  listCredentialMeta: vi.fn(async () => []),
}));

import { runAnalyticsIngest } from "./analyticsIngest.js";
import type { Env } from "../index.js";
import type { FetchLike } from "../engine/ascWrite.js";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;
const STORED = { plaintext: TEST_KEY, meta: { keyId: "KID", issuerId: "ISS" } };

const gunzipPassthrough = async (b: Uint8Array) => new TextDecoder().decode(b);
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ongoing = { data: [{ id: "R1", attributes: { accessType: "ONGOING" } }] };
const FILE = "Date\tSource Type\tImpressions\tProduct Page Views\tTotal Downloads\n2026-07-01\tApp Store Search\t100\t40\t8";
const COMMERCE_FILE = "Date\tContent Name\tPurchase Type\tSales\tProceeds\tPaying Users\n2026-07-01\tWidget\tPaid\t5\t70\t3";

/** Stub the whole ASC graph for any app that reaches fetch. Reports endpoint
 *  returns one report per requested category (engagement/commerce/usage all
 *  "ready" — the category-loop test asserts commerce persists too). */
function graphFetch(opts: { withCommerce?: boolean } = {}): { fetchFn: FetchLike } {
  const fetchFn: FetchLike = async (url: string) => {
    const u = String(url);
    if (u.includes("filter[bundleId]")) return jsonRes({ data: [{ id: "A1" }] });
    if (u.includes("/analyticsReportRequests/R1/reports")) {
      if (u.includes("filter[category]=COMMERCE")) {
        return opts.withCommerce
          ? jsonRes({ data: [{ id: "RPT-C", attributes: { category: "COMMERCE" } }] })
          : jsonRes({ data: [] });
      }
      if (u.includes("filter[category]=APP_USAGE")) return jsonRes({ data: [] });
      return jsonRes({ data: [{ id: "RPT", attributes: { category: "APP_STORE_ENGAGEMENT" } }] });
    }
    if (u.includes("/analyticsReports/RPT-C/instances")) return jsonRes({ data: [{ id: "INST-C", attributes: { granularity: "DAILY" } }] });
    if (u.includes("/analyticsReports/RPT/instances")) return jsonRes({ data: [{ id: "INST", attributes: { granularity: "DAILY" } }] });
    if (u.includes("/analyticsReportInstances/INST-C/segments")) return jsonRes({ data: [{ id: "SEG-C", attributes: { url: "https://signed.example/commerce.gz" } }] });
    if (u.includes("/analyticsReportInstances/INST/segments")) return jsonRes({ data: [{ id: "SEG", attributes: { url: "https://signed.example/seg.gz" } }] });
    if (u === "https://signed.example/seg.gz") return new Response(new TextEncoder().encode(FILE), { status: 200 });
    if (u === "https://signed.example/commerce.gz") return new Response(new TextEncoder().encode(COMMERCE_FILE), { status: 200 });
    if (u.includes("/analyticsReportRequests")) return jsonRes(ongoing);
    return jsonRes({}, 404);
  };
  return { fetchFn };
}

function fakeDb(apps: unknown[]): {
  db: D1Database;
  batches: () => number;
  commerceRows: () => unknown[][];
} {
  let batched = 0;
  const commerceInserts: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const isCommerceInsert = /INSERT INTO analytics_commerce/.test(s);
      const stmt = {
        bind(...a: unknown[]) {
          bound = a;
          if (isCommerceInsert) commerceInserts.push(a);
          return stmt;
        },
        async all<T>() { return { results: (/FROM apps/.test(s) ? apps : []) as T[] }; },
        async first<T>() { return null as T | null; },
        async run() { void bound; return { success: true, meta: { changes: 1 } }; },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { batched++; return stmts.map(() => ({ success: true })); },
  };
  return { db: db as unknown as D1Database, batches: () => batched, commerceRows: () => commerceInserts };
}

const app = (id: string, bundle: string) => ({ id, user_id: "u1", bundle_id: bundle, name: id, country: "US", created_at: "2026-01-01" });
const env = (over: Partial<Env> = {}): Env => ({ DB: fakeDb([]).db, ANALYTICS_ENABLED: "1", ...over }) as Env;

beforeEach(() => { kekOn = true; useCredential.mockReset(); });

describe("runAnalyticsIngest", () => {
  it("is inert when ANALYTICS_ENABLED is unset (no app work)", async () => {
    const noFlag = { DB: fakeDb([]).db } as Env; // ANALYTICS_ENABLED omitted entirely
    const r = await runAnalyticsIngest(noFlag, { fetchFn: graphFetch().fetchFn, gunzip: gunzipPassthrough });
    expect(r).toMatchObject({ enabled: false, appsProcessed: 0 });
    expect(useCredential).not.toHaveBeenCalled();
  });

  it("is inert without a KEK (stored keys can't be decrypted)", async () => {
    kekOn = false;
    const r = await runAnalyticsIngest(env(), { fetchFn: graphFetch().fetchFn, gunzip: gunzipPassthrough });
    expect(r).toMatchObject({ enabled: true, storage: false, appsProcessed: 0 });
  });

  it("ingests an app with a stored key + ready report; skips one with no key", async () => {
    useCredential.mockImplementation(async (_e: unknown, _u: string, appId: string) => (appId === "app1" ? STORED : null));
    const { db, batches } = fakeDb([app("app1", "com.a"), app("app2", "com.b")]);
    const r = await runAnalyticsIngest(env({ DB: db }), { fetchFn: graphFetch().fetchFn, gunzip: gunzipPassthrough });

    expect(r.appsProcessed).toBe(2);
    expect(r.ingested).toBe(1);
    expect(r.skippedNoKey).toBe(1);
    expect(r.perApp.find((p) => p.appId === "app1")).toMatchObject({ rows: 1, days: 1 });
    expect(r.perApp.find((p) => p.appId === "app2")).toMatchObject({ skipped: "no_key" });
    expect(batches()).toBe(1); // exactly one app persisted
  });

  it("ingests COMMERCE alongside Engagement, sharing the same requestId — per-category isolation", async () => {
    useCredential.mockResolvedValue(STORED);
    const { db, batches, commerceRows } = fakeDb([app("app1", "com.a")]);
    const r = await runAnalyticsIngest(env({ DB: db }), {
      fetchFn: graphFetch({ withCommerce: true }).fetchFn,
      gunzip: gunzipPassthrough,
    });

    expect(r.ingested).toBe(1); // Engagement still reported as the app's ingest
    expect(commerceRows().length).toBe(1); // COMMERCE row persisted too
    expect(commerceRows()[0]).toEqual(["app1", "2026-07-01", "Widget", "Paid", 5, 70, 3]);
    // Engagement batch + Commerce batch (Usage stays not_ready → no batch call).
    expect(batches()).toBe(2);
  });

  it("skips (not_ready) an app whose key is stored but has no ongoing request — no throw", async () => {
    useCredential.mockResolvedValue(STORED);
    const noRequest: FetchLike = async (url) =>
      String(url).includes("filter[bundleId]") ? jsonRes({ data: [{ id: "A1" }] })
        : String(url).includes("/analyticsReportRequests") ? jsonRes({ data: [] }) // no ongoing request
        : jsonRes({}, 404);
    const { db } = fakeDb([app("app1", "com.a")]);
    const r = await runAnalyticsIngest(env({ DB: db }), { fetchFn: noRequest, gunzip: gunzipPassthrough });
    expect(r.ingested).toBe(0);
    expect(r.skippedNotReady).toBe(1);
    expect(r.perApp[0]).toMatchObject({ skipped: "not_requested" });
  });
});
