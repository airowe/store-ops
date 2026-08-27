/**
 * The whole Telegram path in one test: link → verify → a run opens → the bot
 * receives the message.
 *
 * Each piece is tested on its own, which is exactly how a feature ships with
 * every part working and the whole doing nothing — the shape of the two bugs
 * already found in this area (migration 0013's unused column, and
 * notification_channels having no route). This asserts the seams.
 */
import { describe, expect, it, vi } from "vitest";
import { handleApi } from "../api/index.js";
import { notifyRunReadyForEnv } from "./forEnv.js";
import { mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-please-ignore";
const HOOK = "hook-secret";
const EMAIL = "owner@example.com";

/** Enough of the schema for the link → verify → deliver path. */
function fakeDb() {
  const user = { id: "u1", email: EMAIL, tier: "scale", status: "active", agent_paused: 0 };
  const codes = new Map<string, Record<string, string>>();
  const channels: Array<Record<string, unknown>> = [];
  const prefs = { push_run_ready: 1, email_digest: "weekly", email_run_ready: 1 };

  function prepare(sql: string) {
    const s = sql.trim().replace(/\s+/g, " ");
    let b: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { b = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE (email|id)/i.test(s)) return { ...user, ...prefs } as T;
        if (/FROM channel_link_codes WHERE code/i.test(s)) return (codes.get(String(b[0])) ?? null) as T | null;
        if (/COUNT\(\*\) AS n FROM channel_link_codes/i.test(s)) return { n: codes.size } as T;
        return null as T | null;
      },
      async run() {
        if (/INSERT INTO channel_link_codes/i.test(s)) {
          codes.set(String(b[0]), {
            user_id: String(b[1]), channel: String(b[2]), label: String(b[3]), expires_at: String(b[5]),
          });
        }
        if (/DELETE FROM channel_link_codes WHERE code/i.test(s)) codes.delete(String(b[0]));
        if (/INSERT INTO notification_channels/i.test(s)) {
          channels.push({ user_id: b[1], channel: b[2], address: b[3], enabled: 1, verified_at: null });
        }
        if (/UPDATE notification_channels SET verified_at/i.test(s)) {
          for (const c of channels) {
            if (c.user_id === b[1] && c.channel === b[2] && c.address === b[3]) {
              c.verified_at = "2026-01-01T00:00:00Z";
            }
          }
        }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() {
        // deliverableDestinations: verified AND enabled only.
        if (/SELECT channel, address FROM notification_channels/i.test(s)) {
          return {
            results: channels
              .filter((c) => c.user_id === b[0] && c.enabled === 1 && c.verified_at !== null)
              .map((c) => ({ channel: c.channel, address: c.address })) as T[],
          };
        }
        return { results: [] as T[] };
      },
    };
    return stmt;
  }
  return { db: { prepare, batch: async (x: unknown[]) => x.map(() => ({ success: true })) } as unknown as D1Database, channels };
}

const envFor = (db: D1Database, fetchImpl: unknown) =>
  ({
    DB: db,
    DEFAULT_COUNTRY: "US",
    APP_ENV: "test",
    SESSION_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_BOT_USERNAME: "ShipASOBot",
    TELEGRAM_WEBHOOK_SECRET: HOOK,
    // fetchForEnv returns workerFetch unless TINYFISH is set; override the
    // global so the deliverer's call is observable.
    __fetch: fetchImpl,
  }) as unknown as Env;

const RUN_ARGS = {
  userId: "u1",
  appName: "Ballpark",
  runId: "r_1",
  status: "awaiting_approval" as const,
  proposed: { name: "Ballpark", subtitle: "Every game, every score", keywords: "a" },
  current: { name: "Ballpark", subtitle: "Track every game", keywords: "a" },
};

describe("Telegram, end to end", () => {
  it("links a chat and then actually delivers a run_ready to it", async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const stub = vi.fn(async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: String(init?.body ?? "") });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ ok: true, result: {} }),
      };
    });
    const original = globalThis.fetch;
    globalThis.fetch = stub as never;
    try {
      const { db, channels } = fakeDb();
      const env = envFor(db, stub);
      const token = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });

      // 1. The owner mints a link.
      const linkRes = await handleApi(
        new Request("https://api.test/account/channels/link", {
          method: "POST",
          headers: { Cookie: `store_ops_session=${token}`, "content-type": "application/json" },
          body: JSON.stringify({ channel: "telegram" }),
        }),
        env,
      );
      expect(linkRes.status).toBe(200);
      const { code } = (await linkRes.json()) as { code: string };

      // 2. They open it; Telegram delivers /start from their chat.
      const hookRes = await handleApi(
        new Request("https://api.test/telegram/webhook", {
          method: "POST",
          headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": HOOK },
          body: JSON.stringify({
            update_id: 1,
            message: { message_id: 1, chat: { id: 5150, type: "private" }, text: `/start ${code}` },
          }),
        }),
        env,
      );
      expect(hookRes.status).toBe(200);
      expect(channels[0]).toMatchObject({ address: "5150" });
      expect(channels[0]!.verified_at).not.toBeNull();

      // 3. A run reaches the gate.
      await notifyRunReadyForEnv(env, RUN_ARGS);

      // 4. The bot was actually called, for that chat, about that app.
      const call = sent.find((c) => c.url.includes("/sendMessage"));
      expect(call, "no Telegram sendMessage was issued").toBeTruthy();
      const payload = JSON.parse(call!.body) as { chat_id: string; text: string };
      expect(payload.chat_id).toBe("5150");
      expect(payload.text).toContain("Ballpark");
      // Approval is the terminus, on every channel.
      expect(payload.text.toLowerCase()).not.toContain("shipped");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("delivers NOTHING to a chat that was linked but never verified", async () => {
    const sent: string[] = [];
    const stub = vi.fn(async (url: string) => {
      sent.push(url);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"ok":true}' };
    });
    const original = globalThis.fetch;
    globalThis.fetch = stub as never;
    try {
      const { db, channels } = fakeDb();
      const env = envFor(db, stub);
      // A row exists but nobody proved control of it.
      channels.push({ user_id: "u1", channel: "telegram", address: "6666", enabled: 1, verified_at: null });
      await notifyRunReadyForEnv(env, RUN_ARGS);
      expect(sent.filter((u) => u.includes("/sendMessage"))).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
