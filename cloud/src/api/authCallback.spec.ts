/**
 * GET /auth/callback — the browser magic-link landing gate. Driven through the
 * real `handleApi` router with a tiny in-memory `users` table (the only table
 * this path touches, via upsertUser). We mint a real magic-link token with the
 * SAME session secret the worker resolves, then hit the callback as a browser
 * (no Accept: application/json) and assert the resulting 302.
 *
 * Regression covered: this branch repointed the web route `/` from the authed
 * dashboard to a public marketing landing page (dashboard now lives at
 * `/dashboard`). The callback's browser redirect must follow suit — a
 * freshly-signed-in user must land on `/dashboard`, not the bare origin (which
 * now shows marketing copy instead of their dashboard).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintMagicToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type UserRecord = { id: string; email: string; created_at: string; tier: string; status: string };

function fakeDb() {
  const users = new Map<string, UserRecord>(); // keyed by email

  function exec(sql: string, args: unknown[]): { row: unknown | null; changes: number } {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT .* FROM users WHERE email = \?$/.test(s)) {
      return { row: users.get(String(args[0])) ?? null, changes: 0 };
    }
    if (/^INSERT INTO users /.test(s)) {
      const [id, email, created_at, tier, status] = args as string[];
      users.set(email!, { id: id!, email: email!, created_at: created_at!, tier: tier!, status: status! });
      return { row: null, changes: 1 };
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(s)) {
      for (const u of users.values()) if (u.id === String(args[0])) return { row: u, changes: 0 };
      return { row: null, changes: 0 };
    }
    throw new Error(`fakeDb: unhandled SQL: ${s}`);
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { return exec(sql, bound).row as T | null; },
      async run() { const r = exec(sql, bound); return { success: true, meta: { changes: r.changes } }; },
      async all<T>() { return { results: [] as T[] }; },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb(),
    DEFAULT_COUNTRY: "US",
    APP_ENV: "production",
    SESSION_SECRET: SECRET,
    ...overrides,
  } as Env;
}

const EMAIL = "owner@example.com";
function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.test${path}`, { method: "GET", headers });
}

describe("GET /auth/callback (browser magic-link gate)", () => {
  it("redirects a freshly-signed-in browser to the dashboard, not the bare origin", async () => {
    const env = makeEnv();
    const magic = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 900 });

    const res = await handleApi(get(`/auth/callback?token=${magic}`), env);

    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).not.toBeNull();
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/dashboard$/);
    // Regression guard: must not be the bare origin (marketing landing page).
    expect(location).not.toBe("https://api.test");
    expect(location).not.toBe("https://api.test/");
  });

  it("honors DASHBOARD_ORIGIN when set, still appending /dashboard", async () => {
    const env = makeEnv({ DASHBOARD_ORIGIN: "https://app.shipaso.com/" });
    const magic = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 900 });

    const res = await handleApi(get(`/auth/callback?token=${magic}`), env);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.shipaso.com/dashboard");
  });

  it("still returns a JSON body (no redirect) for Accept: application/json callers", async () => {
    const env = makeEnv();
    const magic = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 900 });

    const res = await handleApi(
      get(`/auth/callback?token=${magic}`, { Accept: "application/json" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toMatchObject({ ok: true, email: EMAIL });
  });

  it("rejects an invalid token with 400 and no redirect", async () => {
    const env = makeEnv();
    const res = await handleApi(get("/auth/callback?token=not-a-real-token"), env);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});
