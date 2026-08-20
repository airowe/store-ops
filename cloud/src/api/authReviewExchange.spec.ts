/**
 * POST /auth/review-exchange — the App Review sign-in gate (Guideline 2.1(a)).
 *
 * The 0.1.1 rejection: sign-in is passwordless, the reviewer cannot read the
 * mailbox the magic link goes to, and magic tokens expire in 15 minutes so no
 * token can be written into the review notes. This route accepts a LONG-LIVED,
 * audience-separated "review" token that CAN live in the notes, and exchanges it
 * for an ordinary session — but only ever for the one configured review account.
 *
 * Invariants asserted here (each is the reason the route is safe to ship):
 *   • a valid review token for the review account → 200 { token } in the body.
 *   • the returned token authenticates a Bearer-guarded route (a real session).
 *   • a review token for ANY OTHER email → 400, even though it is well-signed.
 *   • a magic/session token is NOT accepted here (audience split, both ways).
 *   • with REVIEW_ACCOUNT_EMAIL unset the route is CLOSED — fail-closed default.
 *   • expired/absent/garbage → the same opaque 400 as every other auth path.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintMagicToken, mintReviewToken, mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVIEWER = "adaminsley+shipaso-review@gmail.com";
const NINETY_DAYS = 90 * 24 * 60 * 60;

type UserRecord = { id: string; email: string; created_at: string; tier: string; status: string };

function fakeDb() {
  const users = new Map<string, UserRecord>();
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

/** Env WITH the review account configured (the shipping posture). */
function makeEnv(): Env {
  return {
    DB: fakeDb(),
    DEFAULT_COUNTRY: "US",
    APP_ENV: "production",
    SESSION_SECRET: SECRET,
    REVIEW_ACCOUNT_EMAIL: REVIEWER,
  } as Env;
}

/** Env WITHOUT it — the default everywhere the review path is not wanted. */
function makeEnvNoReviewAccount(): Env {
  return { DB: fakeDb(), DEFAULT_COUNTRY: "US", APP_ENV: "production", SESSION_SECRET: SECRET } as Env;
}

function post(path: string, body: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/review-exchange (App Review sign-in)", () => {
  it("exchanges a long-lived review token for a session, with no email round-trip", async () => {
    const env = makeEnv();
    const review = await mintReviewToken(SECRET, REVIEWER, { ttlSeconds: NINETY_DAYS });

    const res = await handleApi(post("/auth/review-exchange", { token: review }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();

    const out = (await res.json()) as { token: string; email: string };
    expect(out.email).toBe(REVIEWER);
    expect(typeof out.token).toBe("string");
    expect(out.token.length).toBeGreaterThan(10);
  });

  it("returns a session token that authenticates a Bearer-guarded route", async () => {
    const env = makeEnv();
    const review = await mintReviewToken(SECRET, REVIEWER, { ttlSeconds: NINETY_DAYS });
    const { token } = (await (
      await handleApi(post("/auth/review-exchange", { token: review }), env)
    ).json()) as { token: string };

    const me = await handleApi(
      new Request("https://api.test/auth/me", { headers: { authorization: `Bearer ${token}` } }),
      env,
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ authed: true, via: "session", email: REVIEWER });
  });

  it("REFUSES a well-signed review token for any other email — a leaked token cannot be re-pointed", async () => {
    const env = makeEnv();
    const notTheReviewer = await mintReviewToken(SECRET, "real-customer@example.com", {
      ttlSeconds: NINETY_DAYS,
    });
    const res = await handleApi(post("/auth/review-exchange", { token: notTheReviewer }), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid or expired link" });
  });

  it("is CLOSED when REVIEW_ACCOUNT_EMAIL is unset, even for a valid token", async () => {
    const env = makeEnvNoReviewAccount();
    const review = await mintReviewToken(SECRET, REVIEWER, { ttlSeconds: NINETY_DAYS });
    const res = await handleApi(post("/auth/review-exchange", { token: review }), env);
    expect(res.status).toBe(400);
  });

  it("does NOT accept a magic token (audience split)", async () => {
    const env = makeEnv();
    const magic = await mintMagicToken(SECRET, REVIEWER, { ttlSeconds: 900 });
    const res = await handleApi(post("/auth/review-exchange", { token: magic }), env);
    expect(res.status).toBe(400);
  });

  it("does NOT accept a session token (audience split)", async () => {
    const env = makeEnv();
    const session = await mintSessionToken(SECRET, REVIEWER, { ttlSeconds: 900 });
    const res = await handleApi(post("/auth/review-exchange", { token: session }), env);
    expect(res.status).toBe(400);
  });

  it("does NOT let a review token in through the ordinary /auth/exchange route", async () => {
    const env = makeEnv();
    const review = await mintReviewToken(SECRET, REVIEWER, { ttlSeconds: NINETY_DAYS });
    const res = await handleApi(post("/auth/exchange", { token: review }), env);
    expect(res.status).toBe(400);
  });

  it("rejects an expired review token", async () => {
    const env = makeEnv();
    const expired = await mintReviewToken(SECRET, REVIEWER, { ttlSeconds: 0 });
    const res = await handleApi(post("/auth/review-exchange", { token: expired }), env);
    expect(res.status).toBe(400);
  });

  it("rejects garbage and a missing token field with the same opaque 400", async () => {
    const env = makeEnv();
    expect((await handleApi(post("/auth/review-exchange", { token: "nope" }), env)).status).toBe(400);
    expect((await handleApi(post("/auth/review-exchange", {}), env)).status).toBe(400);
  });
});
