/**
 * POST /auth/exchange — the mobile auth gate. Driven through the real `handleApi`
 * router with a tiny in-memory `users` table (the only table this path touches,
 * via upsertUser). We mint a real magic-link token with the SAME session secret
 * the worker resolves, exchange it, and assert the returned session token then
 * authenticates a Bearer-guarded route — closing the magic-link → Bearer loop.
 *
 * Honesty / security invariants asserted:
 *   • a valid magic token → 200 { token } in the BODY (no Set-Cookie).
 *   • the returned token authenticates `requireUser` as a Bearer header.
 *   • an invalid/expired/missing token → 400 (same opaque error as the cookie
 *     path — never reveals whether the account exists).
 *   • a session token is NOT accepted in place of a magic token (audience split).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintMagicToken, mintSessionToken } from "../auth.js";
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

function makeEnv(): Env {
  return { DB: fakeDb(), DEFAULT_COUNTRY: "US", APP_ENV: "production", SESSION_SECRET: SECRET } as Env;
}

const EMAIL = "owner@example.com";
function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/exchange (mobile auth gate)", () => {
  it("exchanges a valid magic token for a session token in the body (no cookie)", async () => {
    const env = makeEnv();
    const magic = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 900 });

    const res = await handleApi(post("/auth/exchange", { token: magic }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();

    const out = (await res.json()) as { token: string; email: string };
    expect(out.email).toBe(EMAIL);
    expect(typeof out.token).toBe("string");
    expect(out.token.length).toBeGreaterThan(10);
  });

  it("returns a session token that authenticates a Bearer-guarded route", async () => {
    const env = makeEnv();
    const magic = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 900 });
    const { token } = (await (await handleApi(post("/auth/exchange", { token: magic }), env)).json()) as { token: string };

    // /auth/me with the returned Bearer token → authed via session.
    const me = await handleApi(
      new Request("https://api.test/auth/me", { headers: { authorization: `Bearer ${token}` } }),
      env,
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ authed: true, via: "session", email: EMAIL });
  });

  it("rejects an invalid token with 400 and no token leak", async () => {
    const env = makeEnv();
    const res = await handleApi(post("/auth/exchange", { token: "not-a-real-token" }), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid or expired link" });
  });

  it("rejects an expired magic token with 400", async () => {
    const env = makeEnv();
    // mint already-expired (ttl 0 → x == now, verify uses now >= x → expired)
    const expired = await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 0 });
    const res = await handleApi(post("/auth/exchange", { token: expired }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a missing token field with 400", async () => {
    const env = makeEnv();
    const res = await handleApi(post("/auth/exchange", {}), env);
    expect(res.status).toBe(400);
  });

  it("does NOT accept a session token in place of a magic token (audience split)", async () => {
    const env = makeEnv();
    const session = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 900 });
    const res = await handleApi(post("/auth/exchange", { token: session }), env);
    expect(res.status).toBe(400);
  });
});
