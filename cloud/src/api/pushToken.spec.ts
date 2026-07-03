/**
 * POST /account/push-token — the mobile device-token register route, driven
 * through the real `handleApi` router with a tiny in-memory D1 (users +
 * device_tokens). APP_ENV=demo lets us authenticate via X-User-Email.
 *
 * Asserts: a valid Expo token registers (idempotently), a malformed token is
 * rejected 400 (never stored), and the route is auth-gated (401 without a user).
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const TOKEN = "ExponentPushToken[abcdefghijklmnopqrst]";

function fakeDb() {
  const users = new Map<string, { id: string; email: string }>();
  const deviceTokens = new Map<string, { user_id: string; platform: string }>();

  function exec(sql: string, args: unknown[]): { row: unknown | null; changes: number } {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT .* FROM users WHERE email = \?$/.test(s)) {
      return { row: users.get(String(args[0])) ?? null, changes: 0 };
    }
    if (/^INSERT INTO users /.test(s)) {
      const [id, email] = args as string[];
      users.set(email!, { id: id!, email: email! });
      return { row: null, changes: 1 };
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(s)) {
      for (const u of users.values()) if (u.id === String(args[0])) return { row: u, changes: 0 };
      return { row: null, changes: 0 };
    }
    if (/^INSERT INTO device_tokens/.test(s)) {
      const [token, user_id, platform] = args as string[];
      deviceTokens.set(token!, { user_id: user_id!, platform: platform! }); // ON CONFLICT → upsert
      return { row: null, changes: 1 };
    }
    throw new Error(`fakeDb: unhandled SQL: ${s}`);
  }

  const db = {
    __deviceTokens: deviceTokens,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          bound = a;
          return stmt;
        },
        async first<T>() {
          return exec(sql, bound).row as T | null;
        },
        async run() {
          const r = exec(sql, bound);
          return { success: true, meta: { changes: r.changes } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database & { __deviceTokens: Map<string, { user_id: string; platform: string }> };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "demo" } as Env;
}

const EMAIL = "owner@example.com";
function post(path: string, body: unknown, opts: { email?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.email) headers["x-user-email"] = opts.email;
  return new Request(`https://api.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /account/push-token", () => {
  it("registers a valid Expo token for the caller", async () => {
    const db = fakeDb();
    const res = await handleApi(post("/account/push-token", { token: TOKEN, platform: "ios" }, { email: EMAIL }), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: true, platform: "ios" });
    expect((db as unknown as { __deviceTokens: Map<string, unknown> }).__deviceTokens.has(TOKEN)).toBe(true);
  });

  it("defaults platform to ios when omitted", async () => {
    const db = fakeDb();
    const res = await handleApi(post("/account/push-token", { token: TOKEN }, { email: EMAIL }), makeEnv(db));
    expect(await res.json()).toEqual({ registered: true, platform: "ios" });
  });

  it("rejects a malformed token with 400 and stores nothing", async () => {
    const db = fakeDb();
    const res = await handleApi(post("/account/push-token", { token: "nope" }, { email: EMAIL }), makeEnv(db));
    expect(res.status).toBe(400);
    expect((db as unknown as { __deviceTokens: Map<string, unknown> }).__deviceTokens.size).toBe(0);
  });

  it("is auth-gated — no user yields 401", async () => {
    const db = fakeDb();
    const res = await handleApi(post("/account/push-token", { token: TOKEN }), makeEnv(db));
    expect(res.status).toBe(401);
  });
});
