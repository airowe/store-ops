/**
 * /account/notifications — the communication prefs API (comms-prefs Phase 1),
 * driven through the real `handleApi` router with a tiny in-memory `users`
 * table. APP_ENV=demo authenticates via X-User-Email.
 *
 * Asserts: defaults (weekly/on) for a fresh user, partial POST updates, honest
 * 400s on bad values, auth gating, and that /auth/me carries both prefs.
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
  agent_paused: number;
  rlhf_opt_out: number;
  rank_cadence: string;
  email_digest: string | null;
  push_run_ready: number | null;
};

function fakeDb() {
  const users = new Map<string, UserRecord>(); // keyed by email

  const byId = (id: string) => [...users.values()].find((u) => u.id === id);

  function exec(sql: string, args: unknown[]): { row: unknown | null; changes: number } {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT .* FROM users WHERE email = \?$/.test(s)) {
      return { row: users.get(String(args[0])) ?? null, changes: 0 };
    }
    if (/^INSERT INTO users /.test(s)) {
      const [id, email, created_at, tier, status] = args as string[];
      users.set(email!, {
        id: id!, email: email!, created_at: created_at!, tier: tier!, status: status!,
        agent_paused: 0, rlhf_opt_out: 0, rank_cadence: "weekly",
        email_digest: null, push_run_ready: null, // DB defaults modeled as NULL → defaults
      });
      return { row: null, changes: 1 };
    }
    if (/^SELECT email_digest, push_run_ready FROM users WHERE id = \?$/.test(s)) {
      const u = byId(String(args[0]));
      return { row: u ? { email_digest: u.email_digest, push_run_ready: u.push_run_ready } : null, changes: 0 };
    }
    if (/^UPDATE users SET email_digest = \? WHERE id = \?$/.test(s)) {
      const u = byId(String(args[1]));
      if (u) u.email_digest = String(args[0]);
      return { row: null, changes: u ? 1 : 0 };
    }
    if (/^UPDATE users SET push_run_ready = \? WHERE id = \?$/.test(s)) {
      const u = byId(String(args[1]));
      if (u) u.push_run_ready = Number(args[0]);
      return { row: null, changes: u ? 1 : 0 };
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(s)) {
      return { row: byId(String(args[0])) ?? null, changes: 0 };
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

describe("/account/notifications (comms-prefs)", () => {
  it("defaults: fresh user reads weekly + push on (NULL columns → defaults)", async () => {
    const env = makeEnv();
    const res = await handleApi(req("GET", "/account/notifications", { email: EMAIL }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email_digest: "weekly", push_run_ready: true });
  });

  it("POST partially updates: digest off leaves push untouched, and vice versa", async () => {
    const env = makeEnv();
    const r1 = await (await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { email_digest: "off" } }), env)).json();
    expect(r1).toEqual({ email_digest: "off", push_run_ready: true });

    const r2 = await (await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { push_run_ready: false } }), env)).json();
    expect(r2).toEqual({ email_digest: "off", push_run_ready: false });

    const r3 = await (await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { email_digest: "weekly", push_run_ready: true } }), env)).json();
    expect(r3).toEqual({ email_digest: "weekly", push_run_ready: true });
  });

  it("rejects bad values with 400, never silently coercing", async () => {
    const env = makeEnv();
    expect((await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { email_digest: "daily" } }), env)).status).toBe(400);
    expect((await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { push_run_ready: "yes" } }), env)).status).toBe(400);
    expect((await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: {} }), env)).status).toBe(400);
  });

  it("is auth-gated (401 without a user)", async () => {
    const env = makeEnv();
    expect((await handleApi(req("GET", "/account/notifications"), env)).status).toBe(401);
    expect((await handleApi(req("POST", "/account/notifications", { body: { email_digest: "off" } }), env)).status).toBe(401);
  });

  it("/auth/me carries both prefs (the client boot needs no extra call)", async () => {
    const env = makeEnv();
    const me = await (await handleApi(req("GET", "/auth/me", { email: EMAIL }), env)).json();
    expect(me).toMatchObject({ authed: true, email_digest: "weekly", push_run_ready: true });

    await handleApi(req("POST", "/account/notifications", { email: EMAIL, body: { email_digest: "off", push_run_ready: false } }), env);
    const me2 = await (await handleApi(req("GET", "/auth/me", { email: EMAIL }), env)).json();
    expect(me2).toMatchObject({ email_digest: "off", push_run_ready: false });
  });
});
