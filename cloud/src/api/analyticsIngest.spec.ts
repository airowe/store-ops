/**
 * POST /apps/:id/analytics/ingest (analytics-reports Phase 2) — driven through
 * the real `handleApi` router. Global `fetch` is stubbed for the whole graph
 * (app-id lookup → request list → Engagement report → instance → segment → the
 * GZIPPED file); the fake DB captures the upsert batch. Real `mintAscJwt` and the
 * real `gunzipText` (DecompressionStream) run — only Apple is faked.
 *
 * Asserts the route glue: honest passthrough when not ready, and a successful
 * ingest reporting COUNTS (never fabricated metrics) after persisting.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;
const CREDS = { p8: TEST_KEY, keyId: "KID", issuerId: "ISS" };

function fakeDb(): { db: D1Database; batched: () => number } {
  const users = new Map<string, { id: string; email: string }>();
  let lastUserId = "";
  let batched = 0;
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    let bound: unknown[] = [];
    const stmt = {
      sql, args: [] as unknown[],
      bind(...a: unknown[]) { bound = a; this.args = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE email = \?/.test(s)) return (users.get(String(bound[0])) ?? null) as T | null;
        if (/FROM users WHERE id = \?/.test(s)) return ([...users.values()].find((u) => u.id === bound[0]) ?? null) as T | null;
        if (/FROM apps WHERE id = \?/.test(s)) return { id: String(bound[0]), user_id: lastUserId, bundle_id: "com.test.app", name: "T", country: "US", created_at: "2026-01-01" } as T;
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
  const db = { prepare, async batch(stmts: unknown[]) { batched++; return stmts.map(() => ({ success: true })); } };
  return { db: db as unknown as D1Database, batched: () => batched };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}
function req(): Request {
  return new Request("https://api.test/apps/app1/analytics/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-email": "owner@example.com" },
    body: JSON.stringify(CREDS),
  });
}

async function gzip(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Response(new TextEncoder().encode(text)).body!.pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ongoing = { data: [{ id: "R1", attributes: { accessType: "ONGOING" } }] };

afterEach(() => vi.unstubAllGlobals());

describe("POST /apps/:id/analytics/ingest", () => {
  it("honest passthrough: a non-Admin key → admin_required, nothing persisted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("filter[bundleId]")) return jsonRes({ data: [{ id: "9999" }] });
      if (String(url).includes("/analyticsReportRequests")) return jsonRes({ errors: [] }, 403); // Phase-1 probe
      return jsonRes({}, 404);
    }));
    const { db, batched } = fakeDb();
    const res = await handleApi(req(), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "admin_required" });
    expect(batched()).toBe(0);
  });

  it("request exists but Apple is still generating → pending, nothing persisted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("filter[bundleId]")) return jsonRes({ data: [{ id: "9999" }] });
      if (u.includes("/analyticsReportRequests/R1/reports")) return jsonRes({ data: [] }); // no Engagement report yet
      if (u.includes("/analyticsReportRequests")) return jsonRes(ongoing);
      return jsonRes({}, 404);
    }));
    const { db, batched } = fakeDb();
    const res = await handleApi(req(), makeEnv(db));
    expect(await res.json()).toMatchObject({ state: "pending" });
    expect(batched()).toBe(0);
  });

  it("ready report → ingests the gzipped segment and persists, reporting counts", async () => {
    const file = "Date\tSource Type\tImpressions\tProduct Page Views\tTotal Downloads\n2026-07-01\tApp Store Search\t100\t40\t8";
    const gz = await gzip(file);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("filter[bundleId]")) return jsonRes({ data: [{ id: "9999" }] });
      if (u.includes("/analyticsReportRequests/R1/reports")) return jsonRes({ data: [{ id: "RPT", attributes: { category: "APP_STORE_ENGAGEMENT" } }] });
      if (u.includes("/analyticsReports/RPT/instances")) return jsonRes({ data: [{ id: "INST", attributes: { granularity: "DAILY" } }] });
      if (u.includes("/analyticsReportInstances/INST/segments")) return jsonRes({ data: [{ id: "SEG", attributes: { url: "https://signed.example/seg.gz" } }] });
      if (u === "https://signed.example/seg.gz") return new Response(gz, { status: 200 });
      if (u.includes("/analyticsReportRequests")) return jsonRes(ongoing);
      return jsonRes({}, 404);
    }));
    const { db, batched } = fakeDb();
    const res = await handleApi(req(), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "ingested", instances: 1, rowsPersisted: 1, days: 1 });
    expect(batched()).toBe(1); // persisted in one atomic batch
  });
});
