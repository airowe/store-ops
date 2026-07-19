/**
 * GET /apps/:id/markets + GET /apps/:id/ranks?country= (#180 Phase 2 — the market
 * picker), through the real `handleApi` router. The fake DB answers users + the
 * app read + the two rank queries by SQL, capturing the country bind so we prove
 * `?country=` actually scopes the rank read (the gap Phase 1 left).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

type Snapshot = { id: number; app_id: string; keyword: string; rank: number | null; total: number; country: string; checked_at: string };

function fakeDb(snapshots: Snapshot[], markets: string[]) {
  const users = new Map<string, { id: string; email: string }>();
  let lastUserId = "";
  const captured: Array<{ sql: string; args: unknown[] }> = [];
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; captured.push({ sql: s, args: a }); return stmt; },
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
        if (/DISTINCT country FROM rank_snapshots/.test(s)) return { results: markets.map((c) => ({ country: c })) as T[] };
        if (/FROM rank_snapshots/.test(s)) {
          // honor a country bind if present (mirrors getRankHistory's scoping)
          const cc = bound.find((b) => typeof b === "string" && /^[a-z]{2}$/.test(b));
          const rows = cc ? snapshots.filter((r) => r.country === cc) : snapshots;
          return { results: rows as T[] };
        }
        return { results: [] as T[] };
      },
    };
    return stmt;
  }
  return { db: { prepare } as unknown as D1Database, captured };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}
function get(path: string, email = "owner@example.com"): Request {
  return new Request(`https://api.test${path}`, { method: "GET", headers: { "x-user-email": email } });
}

const SNAP = (over: Partial<Snapshot>): Snapshot =>
  ({ id: 1, app_id: "app1", keyword: "meal planner", rank: 10, total: 200, country: "us", checked_at: "2026-07-01T00:00:00Z", ...over });

describe("GET /apps/:id/markets", () => {
  it("returns the app's home storefront + the tracked markets", async () => {
    const { db } = fakeDb([], ["us", "jp", "de"]);
    const res = await handleApi(get("/apps/app1/markets"), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ home: "us", markets: ["us", "jp", "de"] });
  });

  it("empty markets for a never-swept app (no fabricated list)", async () => {
    const { db } = fakeDb([], []);
    const res = await handleApi(get("/apps/app1/markets"), makeEnv(db));
    expect(await res.json()).toEqual({ home: "us", markets: [] });
  });

  it("401 without a user", async () => {
    const { db } = fakeDb([], ["us"]);
    expect((await handleApi(get("/apps/app1/markets", ""), makeEnv(db))).status).toBe(401);
  });
});

describe("GET /apps/:id/ranks?country=", () => {
  it("scopes the rank series to the chosen storefront", async () => {
    const snapshots = [
      SNAP({ id: 1, country: "us", keyword: "meal planner", rank: 10 }),
      SNAP({ id: 2, country: "jp", keyword: "meal planner", rank: 3 }),
    ];
    const { db, captured } = fakeDb(snapshots, ["us", "jp"]);
    const res = await handleApi(get("/apps/app1/ranks?keyword=meal%20planner&country=jp"), makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keyword: string; country: string; points: Array<{ rank: number }> };
    expect(body.country).toBe("jp");
    // only the jp snapshot's rank comes back
    expect(body.points.map((p) => p.rank)).toEqual([3]);
    // the country was actually bound into a rank_snapshots read
    expect(captured.some((c) => /FROM rank_snapshots/.test(c.sql) && c.args.includes("jp"))).toBe(true);
  });

  it("without country → unscoped (today's behavior), country echoed as null", async () => {
    const snapshots = [SNAP({ country: "us", rank: 10 }), SNAP({ id: 2, country: "jp", rank: 3 })];
    const { db } = fakeDb(snapshots, ["us", "jp"]);
    const res = await handleApi(get("/apps/app1/ranks?keyword=meal%20planner"), makeEnv(db));
    const body = (await res.json()) as { country: string | null; points: unknown[] };
    expect(body.country).toBeNull();
    expect(body.points.length).toBe(2); // both markets
  });
});
