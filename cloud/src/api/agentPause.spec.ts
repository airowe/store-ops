/**
 * Agent pause/resume API routes (#51), driven through the real `handleApi` router
 * with a tiny in-memory D1 that models just the `users` table these routes touch
 * (upsertUser + setAgentPaused + the /auth/me read-back). APP_ENV=demo lets us
 * authenticate with the X-User-Email header, so no cookie crypto is needed.
 *
 * Asserts: POST /agent/pause flips the flag, /auth/me reflects it, /agent/resume
 * clears it, and the routes are auth-gated (no email → 401).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

// ── in-memory D1 modeling the `users` table ───────────────────────────────────
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
};

function fakeDb() {
  const users = new Map<string, UserRecord>(); // keyed by email

  function byEmail(email: string): UserRecord | undefined {
    return users.get(email);
  }
  function byId(id: string): UserRecord | undefined {
    for (const u of users.values()) if (u.id === id) return u;
    return undefined;
  }

  function exec(sql: string, args: unknown[]): { row: unknown | null; changes: number } {
    const s = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT .* FROM users WHERE email = \?$/.test(s)) {
      return { row: byEmail(String(args[0])) ?? null, changes: 0 };
    }
    if (/^SELECT agent_paused FROM users WHERE id = \?$/.test(s)) {
      const u = byId(String(args[0]));
      return { row: u ? { agent_paused: u.agent_paused } : null, changes: 0 };
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(s)) {
      return { row: byId(String(args[0])) ?? null, changes: 0 };
    }
    if (/^INSERT INTO users/.test(s)) {
      const id = String(args[0]);
      const email = String(args[1]);
      const created_at = String(args[2]);
      const tier = String(args[3]);
      const status = String(args[4]);
      users.set(email, {
        id, email, created_at, tier, status,
        stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null,
        github_installation_id: null, github_repo: null, agent_paused: 0,
      });
      return { row: null, changes: 1 };
    }
    if (/^UPDATE users SET agent_paused = \? WHERE id = \?$/.test(s)) {
      const u = byId(String(args[1]));
      if (u) u.agent_paused = Number(args[0]);
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
function req(method: string, path: string, email?: string): Request {
  const headers: Record<string, string> = {};
  if (email) headers["x-user-email"] = email;
  return new Request(`https://api.test${path}`, { method, headers });
}

describe("POST /agent/pause | /agent/resume (#51)", () => {
  it("pause sets paused:true and /auth/me reflects it; resume clears it", async () => {
    const env = makeEnv();

    const paused = await (await handleApi(req("POST", "/agent/pause", EMAIL), env)).json();
    expect(paused).toEqual({ paused: true });

    const me1 = await (await handleApi(req("GET", "/auth/me", EMAIL), env)).json();
    expect(me1).toMatchObject({ authed: true, via: "demo", email: EMAIL, paused: true });

    const resumed = await (await handleApi(req("POST", "/agent/resume", EMAIL), env)).json();
    expect(resumed).toEqual({ paused: false });

    const me2 = await (await handleApi(req("GET", "/auth/me", EMAIL), env)).json();
    expect(me2).toMatchObject({ paused: false });
  });

  it("defaults to paused:false for a brand-new user (today's behavior preserved)", async () => {
    const env = makeEnv();
    const me = await (await handleApi(req("GET", "/auth/me", EMAIL), env)).json();
    expect(me).toMatchObject({ authed: true, paused: false });
  });

  it("is auth-gated — no email yields 401, never a silent pause", async () => {
    const env = makeEnv();
    const res = await handleApi(req("POST", "/agent/pause"), env);
    expect(res.status).toBe(401);
  });
});
