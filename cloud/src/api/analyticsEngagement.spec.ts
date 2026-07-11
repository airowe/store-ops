/**
 * GET /apps/:id/analytics/engagement (analytics-reports Phase 3) — the measured
 * conversion surface, through the real `handleApi` router. Reads our own D1 (no
 * ASC, no credential); the fake DB answers the series + runs reads by SQL.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function fakeDb(series: unknown[]): D1Database {
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
        if (/FROM apps WHERE id = \?/.test(s)) return { id: String(bound[0]), user_id: lastUserId, bundle_id: "com.test.app", name: "T", country: "US", created_at: "2026-01-01" } as T;
        return null as T | null;
      },
      async run() {
        if (/^INSERT INTO users/.test(s)) { lastUserId = String(bound[0]); users.set(String(bound[1]), { id: String(bound[0]), email: String(bound[1]) }); }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() {
        if (/FROM analytics_engagement/.test(s)) return { results: series as T[] };
        return { results: [] as T[] }; // runs, etc.
      },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(series: unknown[]): Env {
  return { DB: fakeDb(series), DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}
function req(): Request {
  return new Request("https://api.test/apps/app1/analytics/engagement", {
    method: "GET",
    headers: { "x-user-email": "owner@example.com" },
  });
}

describe("GET /apps/:id/analytics/engagement", () => {
  it("no ingested data → honest no_data, never a zero series", async () => {
    const res = await handleApi(req(), makeEnv([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "no_data" });
  });

  it("with a persisted series → measured latest conversion (downloads/PPV), no fabricated movement", async () => {
    const series = [
      { date: "2026-07-01", source: "Search", cpp: "", page_type: "", impressions: 1000, product_page_views: 100, downloads: 10 },
      { date: "2026-07-02", source: "Search", cpp: "", page_type: "", impressions: 1200, product_page_views: 200, downloads: 40 },
    ];
    const res = await handleApi(req(), makeEnv(series));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; latestConversion: { date: string; rate: number }; movements: unknown[]; days: number };
    expect(body.state).toBe("measured");
    expect(body.latestConversion).toEqual({ date: "2026-07-02", rate: 0.2 }); // 40/200
    expect(body.movements).toEqual([]); // no approved pushes → no movement claimed
    expect(body.days).toBe(2);
  });
});
