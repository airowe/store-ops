/**
 * Rank cadence API route (#94), driven through the real `handleApi` router with a
 * tiny in-memory D1 that models just the `users` table these routes touch
 * (upsertUser + setRankCadence + the /auth/me read-back). APP_ENV=demo lets us
 * authenticate with the X-User-Email header.
 *
 * Asserts: POST /account/rank-cadence flips the setting, /auth/me reflects it,
 * the default is 'weekly' (today's behavior preserved), a bad value is rejected,
 * and the route is auth-gated (no email → 401, never a silent cadence change).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

type UserRecord = {
  id: string;
  email: string;
  created_at: string;
  tier: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  github_installation_id: string | null;
  github_repo: string | null;
  agent_paused: number;
  rlhf_opt_out: number;
  rank_cadence: string;
};

function fakeDb() {
  const users = new Map<string, UserRecord>(); // keyed by email
  const byEmail = (email: string) => users.get(email);
  const byId = (id: string) => {
    for (const u of users.values()) if (u.id === id) return u;
    return undefined;
  };

  function exec(sql: string, args: unknown[]): { row: unknown | null; changes: number } {
    const s = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT .* FROM users WHERE email = \?$/.test(s)) {
      return { row: byEmail(String(args[0])) ?? null, changes: 0 };
    }
    if (/^SELECT rank_cadence FROM users WHERE id = \?$/.test(s)) {
      const u = byId(String(args[0]));
      return { row: u ? { rank_cadence: u.rank_cadence } : null, changes: 0 };
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(s)) {
      return { row: byId(String(args[0])) ?? null, changes: 0 };
    }
    if (/^INSERT INTO users/.test(s)) {
      const [id, email, created_at, tier, status] = args.map(String) as [string, string, string, string, string];
      users.set(email, {
        id, email, created_at, tier, status,
        stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null,
        github_installation_id: null, github_repo: null, agent_paused: 0, rlhf_opt_out: 0,
        rank_cadence: "weekly",
      });
      return { row: null, changes: 1 };
    }
    if (/^UPDATE users SET rank_cadence = \? WHERE id = \?$/.test(s)) {
      const u = byId(String(args[1]));
      if (u) u.rank_cadence = String(args[0]);
      return { row: null, changes: u ? 1 : 0 };
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

function makeEnv(): Env {
  return { DB: fakeDb(), DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}

const EMAIL = "owner@example.com";
function req(method: string, path: string, opts: { email?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.email) headers["x-user-email"] = opts.email;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`https://api.test${path}`, init);
}

describe("POST /account/rank-cadence (#94)", () => {
  it("sets daily and /auth/me reflects it; resetting to weekly clears it", async () => {
    const env = makeEnv();

    const set = await (await handleApi(req("POST", "/account/rank-cadence", { email: EMAIL, body: { cadence: "daily" } }), env)).json();
    expect(set).toEqual({ rank_cadence: "daily" });

    const me1 = await (await handleApi(req("GET", "/auth/me", { email: EMAIL }), env)).json();
    expect(me1).toMatchObject({ authed: true, email: EMAIL, rank_cadence: "daily" });

    const back = await (await handleApi(req("POST", "/account/rank-cadence", { email: EMAIL, body: { cadence: "weekly" } }), env)).json();
    expect(back).toEqual({ rank_cadence: "weekly" });

    const me2 = await (await handleApi(req("GET", "/auth/me", { email: EMAIL }), env)).json();
    expect(me2).toMatchObject({ rank_cadence: "weekly" });
  });

  it("defaults to weekly for a brand-new user (today's behavior preserved)", async () => {
    const env = makeEnv();
    const me = await (await handleApi(req("GET", "/auth/me", { email: EMAIL }), env)).json();
    expect(me).toMatchObject({ authed: true, rank_cadence: "weekly" });
  });

  it("rejects a value outside the enum with 400", async () => {
    const env = makeEnv();
    const res = await handleApi(req("POST", "/account/rank-cadence", { email: EMAIL, body: { cadence: "hourly" } }), env);
    expect(res.status).toBe(400);
  });

  it("is auth-gated — no email yields 401, never a silent cadence change", async () => {
    const env = makeEnv();
    const res = await handleApi(req("POST", "/account/rank-cadence", { body: { cadence: "daily" } }), env);
    expect(res.status).toBe(401);
  });
});
