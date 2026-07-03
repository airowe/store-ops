/**
 * /email/unsubscribe (comms-prefs Phase 2) — the compliance path, driven through
 * the real `handleApi` router.
 *
 * The load-bearing behaviors:
 *   • GET NEVER mutates (scanner-prefetch safety) — it renders a confirm page.
 *   • POST flips email_digest='off' idempotently; both the confirm-form POST and
 *     the RFC 8058 one-click POST are form-encoded and must not hit readJson.
 *   • audience separation BOTH directions (session/magic ⇸ unsub).
 *   • non-creating flip: a deleted account gets the same page, no row appears.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import {
  mintMagicToken,
  mintSessionToken,
  mintUnsubToken,
  verifyMagicToken,
  verifySessionToken,
} from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EMAIL = "owner@example.com";

function fakeDb() {
  const users = new Map<string, { id: string; email: string; email_digest: string }>();
  users.set(EMAIL, { id: "u1", email: EMAIL, email_digest: "weekly" });

  const db = {
    __users: users,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const s = sql.replace(/\s+/g, " ").trim();
      const stmt = {
        bind(...a: unknown[]) { bound = a; return stmt; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() {
          if (/^UPDATE users SET email_digest = \? WHERE email = \?$/.test(s)) {
            const u = users.get(String(bound[1]));
            if (u) {
              u.email_digest = String(bound[0]);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          throw new Error(`fakeDb: unhandled SQL: ${s}`);
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database & { __users: Map<string, { email_digest: string }> };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "production", SESSION_SECRET: SECRET } as Env;
}

const BASE = "https://api.test/email/unsubscribe";

describe("GET /email/unsubscribe", () => {
  it("renders the confirm page WITHOUT changing anything (prefetch safety)", async () => {
    const db = fakeDb();
    const token = await mintUnsubToken(SECRET, EMAIL, { ttlSeconds: 3600 });
    const res = await handleApi(new Request(`${BASE}?token=${encodeURIComponent(token)}`), makeEnv(db));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Stop the weekly digest?");
    expect(html).toContain(EMAIL);
    expect(html).toContain("every app on the account");
    // THE invariant: GET mutated nothing.
    expect(db.__users.get(EMAIL)!.email_digest).toBe("weekly");
  });

  it("invalid/expired token → generic 400 page, token never echoed", async () => {
    const db = fakeDb();
    const expired = await mintUnsubToken(SECRET, EMAIL, { ttlSeconds: 0 });
    for (const t of ["garbage", expired]) {
      const res = await handleApi(new Request(`${BASE}?token=${encodeURIComponent(t)}`), makeEnv(db));
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).not.toContain(t);
      expect(html).toContain("isn't valid anymore");
    }
  });
});

describe("POST /email/unsubscribe", () => {
  it("flips email_digest to off — with a form-encoded body (never readJson)", async () => {
    const db = fakeDb();
    const token = await mintUnsubToken(SECRET, EMAIL, { ttlSeconds: 3600 });
    const res = await handleApi(
      new Request(`${BASE}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click", // the RFC 8058 one-click body
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Weekly digest off");
    expect(db.__users.get(EMAIL)!.email_digest).toBe("off");
  });

  it("is idempotent — a repeat POST is the same 200", async () => {
    const db = fakeDb();
    const token = await mintUnsubToken(SECRET, EMAIL, { ttlSeconds: 3600 });
    const post = () =>
      handleApi(new Request(`${BASE}?token=${encodeURIComponent(token)}`, { method: "POST" }), makeEnv(db));
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(db.__users.get(EMAIL)!.email_digest).toBe("off");
  });

  it("a deleted account gets the same success page and NO row is created", async () => {
    const db = fakeDb();
    const token = await mintUnsubToken(SECRET, "gone@example.com", { ttlSeconds: 3600 });
    const res = await handleApi(
      new Request(`${BASE}?token=${encodeURIComponent(token)}`, { method: "POST" }),
      makeEnv(db),
    );
    expect(res.status).toBe(200); // nothing to leak
    expect(db.__users.has("gone@example.com")).toBe(false); // never resurrected
  });
});

describe("audience separation (both directions)", () => {
  it("session and magic tokens FAIL as unsub tokens", async () => {
    const db = fakeDb();
    for (const t of [
      await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 }),
      await mintMagicToken(SECRET, EMAIL, { ttlSeconds: 3600 }),
    ]) {
      const res = await handleApi(
        new Request(`${BASE}?token=${encodeURIComponent(t)}`, { method: "POST" }),
        makeEnv(db),
      );
      expect(res.status).toBe(400);
      expect(db.__users.get(EMAIL)!.email_digest).toBe("weekly"); // untouched
    }
  });

  it("an unsub token FAILS session and magic verification", async () => {
    const unsub = await mintUnsubToken(SECRET, EMAIL, { ttlSeconds: 3600 });
    expect((await verifySessionToken(SECRET, unsub)).ok).toBe(false);
    expect((await verifyMagicToken(SECRET, unsub)).ok).toBe(false);
  });
});
