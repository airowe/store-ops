/**
 * GET /apps/:id/analytics/commerce and /apps/:id/analytics/usage (analytics-reports
 * Phase 3/Task 6) — measured COMMERCE / APP_USAGE surfaces, through the real
 * `handleApi` router. Reads our own D1 (no ASC, no credential); the fake DB
 * answers the series reads by SQL, mirroring analyticsEngagement.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function fakeDb(commerceSeries: unknown[], usageSeries: unknown[]): D1Database {
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
        if (/FROM analytics_commerce/.test(s)) return { results: commerceSeries as T[] };
        if (/FROM analytics_usage/.test(s)) return { results: usageSeries as T[] };
        return { results: [] as T[] };
      },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(commerceSeries: unknown[], usageSeries: unknown[]): Env {
  return { DB: fakeDb(commerceSeries, usageSeries), DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}
function req(path: string): Request {
  return new Request(`https://api.test/apps/app1/analytics/${path}`, {
    method: "GET",
    headers: { "x-user-email": "owner@example.com" },
  });
}

describe("GET /apps/:id/analytics/commerce", () => {
  it("no ingested data → honest no_data, never a zero series", async () => {
    const res = await handleApi(req("commerce"), makeEnv([], []));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "no_data" });
  });

  it("with a persisted series → measured, series returned as-stored", async () => {
    const series = [
      { date: "2026-07-01", content_name: "", purchase_type: "", sales: null, proceeds: 70, paying_users: null },
    ];
    const res = await handleApi(req("commerce"), makeEnv(series, []));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; series: unknown[]; days: number };
    expect(body.state).toBe("measured");
    expect(body.series.length).toBe(1);
    expect(body.days).toBe(1);
  });
});

describe("GET /apps/:id/analytics/usage", () => {
  it("no ingested data → honest no_data, never a zero series", async () => {
    const res = await handleApi(req("usage"), makeEnv([], []));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "no_data" });
  });

  it("with a persisted series → measured, series returned as-stored", async () => {
    const series = [
      { date: "2026-07-01", app_version: "1.0", device: "iPhone", sessions: 5, active_devices: null, installations: null, deletions: null, crashes: 0, unique_devices: 3 },
    ];
    const res = await handleApi(req("usage"), makeEnv([], series));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; series: unknown[]; days: number };
    expect(body.state).toBe("measured");
    expect(body.series.length).toBe(1);
    expect(body.days).toBe(1);
  });
});
