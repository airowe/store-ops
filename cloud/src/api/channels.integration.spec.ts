/**
 * The notification-channel routes, as the ROUTER serves them.
 *
 * Two surfaces meet here, with very different trust:
 *   • /account/channels — the signed-in owner managing their destinations.
 *   • /telegram/webhook — the OPEN INTERNET. Telegram POSTs here, and so can
 *     anyone who guesses the path. Nothing it says about identity is trusted;
 *     the only thing that links a chat to an account is a single-use code the
 *     account itself minted.
 *
 * The webhook tests are therefore mostly refusals, and they are the point: a
 * bad secret, a missing code, a replayed code and an unknown code must all fail
 * to link, or the whole verification story is decorative.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-please-ignore";
const HOOK_SECRET = "hook-secret";
const EMAIL = "owner@example.com";

/** An in-memory stand-in with just enough tables for these routes. */
function fakeDb() {
  const user = { id: "u1", email: EMAIL, tier: "scale", status: "active", agent_paused: 0 };
  const codes = new Map<string, { user_id: string; channel: string; label: string; expires_at: string }>();
  const channels: Array<Record<string, unknown>> = [];

  function prepare(sql: string) {
    const s = sql.trim().replace(/\s+/g, " ");
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE (email|id)/i.test(s)) return user as T;
        if (/FROM channel_link_codes WHERE code/i.test(s)) {
          return (codes.get(String(bound[0])) ?? null) as T | null;
        }
        if (/COUNT\(\*\) AS n FROM channel_link_codes/i.test(s)) {
          return { n: codes.size } as T;
        }
        return null as T | null;
      },
      async run() {
        if (/INSERT INTO channel_link_codes/i.test(s)) {
          codes.set(String(bound[0]), {
            user_id: String(bound[1]),
            channel: String(bound[2]),
            label: String(bound[3]),
            expires_at: String(bound[5]),
          });
        }
        if (/DELETE FROM channel_link_codes WHERE code/i.test(s)) codes.delete(String(bound[0]));
        if (/INSERT INTO notification_channels/i.test(s)) {
          channels.push({ user_id: bound[1], channel: bound[2], address: bound[3], verified_at: null });
        }
        if (/UPDATE notification_channels SET verified_at/i.test(s)) {
          for (const c of channels) {
            if (c.user_id === bound[1] && c.channel === bound[2] && c.address === bound[3]) {
              c.verified_at = "2026-01-01T00:00:00Z";
            }
          }
        }
        if (/DELETE FROM notification_channels/i.test(s)) {
          for (let i = channels.length - 1; i >= 0; i--) {
            const c = channels[i]!;
            if (c.user_id === bound[0] && c.channel === bound[1] && c.address === bound[2]) {
              channels.splice(i, 1);
            }
          }
        }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() {
        if (/FROM notification_channels WHERE user_id/i.test(s)) {
          return { results: channels.filter((c) => c.user_id === bound[0]) as T[] };
        }
        return { results: [] as T[] };
      },
    };
    return stmt;
  }
  const batch = async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } }));
  return { db: { prepare, batch } as unknown as D1Database, codes, channels };
}

const envFor = (db: D1Database, extra: Record<string, unknown> = {}) =>
  ({
    DB: db,
    DEFAULT_COUNTRY: "US",
    APP_ENV: "test",
    SESSION_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_BOT_USERNAME: "ShipASOBot",
    TELEGRAM_WEBHOOK_SECRET: HOOK_SECRET,
    ...extra,
  }) as unknown as Env;

async function authed(): Promise<Record<string, string>> {
  const t = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });
  return { Cookie: `store_ops_session=${t}`, "content-type": "application/json" };
}

/** POST /account/channels/link → the deep link + its code. */
async function mintLink(env: Env) {
  const res = await handleApi(
    new Request("https://api.test/account/channels/link", {
      method: "POST",
      headers: await authed(),
      body: JSON.stringify({ channel: "telegram", label: "Phone" }),
    }),
    env,
  );
  return { res, body: (await res.json()) as { url?: string; code?: string; expiresInSeconds?: number } };
}

/** A Telegram update as the Bot API delivers it. */
const update = (text: string, chatId = 4242) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
});

async function webhook(env: Env, body: unknown, secret: string | null = HOOK_SECRET) {
  return handleApi(
    new Request("https://api.test/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("POST /account/channels/link", () => {
  it("returns a t.me deep link carrying a code inside Telegram's 64-char limit", async () => {
    const { db } = fakeDb();
    const { res, body } = await mintLink(envFor(db));
    expect(res.status).toBe(200);
    expect(body.url).toMatch(/^https:\/\/t\.me\/ShipASOBot\?start=/);
    const payload = new URL(body.url!).searchParams.get("start")!;
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses an unauthenticated caller", async () => {
    const { db } = fakeDb();
    const res = await handleApi(
      new Request("https://api.test/account/channels/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "telegram" }),
      }),
      envFor(db),
    );
    expect(res.status).toBe(401);
  });

  it("refuses a channel this deployment cannot deliver on", async () => {
    const { db } = fakeDb();
    const res = await handleApi(
      new Request("https://api.test/account/channels/link", {
        method: "POST",
        headers: await authed(),
        body: JSON.stringify({ channel: "carrier-pigeon" }),
      }),
      envFor(db),
    );
    expect(res.status).toBe(400);
  });

  it("refuses when no bot is configured — no link can possibly work", async () => {
    const { db } = fakeDb();
    const env = envFor(db, { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_BOT_USERNAME: undefined });
    const res = await handleApi(
      new Request("https://api.test/account/channels/link", {
        method: "POST",
        headers: await authed(),
        body: JSON.stringify({ channel: "telegram" }),
      }),
      env,
    );
    expect(res.status).toBe(503);
  });
});

describe("POST /telegram/webhook", () => {
  it("links and VERIFIES the chat when /start carries a live code", async () => {
    const { db, channels } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    const res = await webhook(env, update(`/start ${body.code}`));
    expect(res.status).toBe(200);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ channel: "telegram", address: "4242" });
    // Verified in the same step: arriving from the chat IS the proof.
    expect(channels[0]!.verified_at).not.toBeNull();
  });

  it("REFUSES a request with the wrong secret token", async () => {
    const { db, channels } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    const res = await webhook(env, update(`/start ${body.code}`), "wrong-secret");
    expect(res.status).toBe(401);
    expect(channels).toHaveLength(0);
  });

  it("REFUSES a request with no secret token at all", async () => {
    const { db, channels } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    const res = await webhook(env, update(`/start ${body.code}`), null);
    expect(res.status).toBe(401);
    expect(channels).toHaveLength(0);
  });

  it("does NOT link on a REPLAYED code — the link sits in a chat log", async () => {
    const { db, channels } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    await webhook(env, update(`/start ${body.code}`, 1111));
    // Someone else scrolls back and opens the same link.
    await webhook(env, update(`/start ${body.code}`, 9999));
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ address: "1111" });
  });

  it("does NOT link on an unknown code", async () => {
    const { db, channels } = fakeDb();
    const res = await webhook(envFor(db), update("/start totally-made-up"));
    expect(res.status).toBe(200); // acknowledged, so Telegram stops retrying
    expect(channels).toHaveLength(0);
  });

  it("does NOT link on a bare /start with no payload", async () => {
    const { db, channels } = fakeDb();
    const res = await webhook(envFor(db), update("/start"));
    expect(res.status).toBe(200);
    expect(channels).toHaveLength(0);
  });

  it("ignores ordinary chatter without failing", async () => {
    const { db, channels } = fakeDb();
    const res = await webhook(envFor(db), update("hello bot"));
    expect(res.status).toBe(200);
    expect(channels).toHaveLength(0);
  });

  it("ignores an update with no message at all", async () => {
    const { db } = fakeDb();
    const res = await webhook(envFor(db), { update_id: 7 });
    expect(res.status).toBe(200);
  });

  it("ACKNOWLEDGES malformed JSON rather than making Telegram retry forever", async () => {
    const { db } = fakeDb();
    const res = await handleApi(
      new Request("https://api.test/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": HOOK_SECRET,
        },
        body: "{not json",
      }),
      envFor(db),
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /account/channels", () => {
  it("lists the caller's destinations", async () => {
    const { db } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    await webhook(env, update(`/start ${body.code}`));
    const res = await handleApi(
      new Request("https://api.test/account/channels", { headers: await authed() }),
      env,
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { channels: Array<{ channel: string; verified: boolean }> };
    expect(out.channels[0]).toMatchObject({ channel: "telegram", verified: true });
  });

  it("refuses an unauthenticated caller", async () => {
    const { db } = fakeDb();
    const res = await handleApi(new Request("https://api.test/account/channels"), envFor(db));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /account/channels", () => {
  it("removes a destination", async () => {
    const { db, channels } = fakeDb();
    const env = envFor(db);
    const { body } = await mintLink(env);
    await webhook(env, update(`/start ${body.code}`));
    const res = await handleApi(
      new Request("https://api.test/account/channels", {
        method: "DELETE",
        headers: await authed(),
        body: JSON.stringify({ channel: "telegram", address: "4242" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(channels).toHaveLength(0);
  });
});
