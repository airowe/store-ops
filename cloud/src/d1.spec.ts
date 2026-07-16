import { describe, it, expect } from "vitest";
import { activeSubscribers, subscriberCounts, unsubscribeSubscriber, recordBroadcast, recordSubscriber } from "./d1.js";

// Minimal in-memory D1 shim: enough for these four helpers.
function fakeDb() {
  const subs: { id: string; email: string; source: string | null; unsubscribed_at: string | null }[] = [];
  const broadcasts: unknown[] = [];
  const api = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async run() {
          if (/^INSERT OR IGNORE INTO subscribers/i.test(s)) {
            const [id, email, source] = bound as [string, string, string | null];
            if (!subs.find((r) => r.email === email)) subs.push({ id, email, source, unsubscribed_at: null });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE subscribers SET unsubscribed_at/i.test(s)) {
            const email = bound[0] as string;
            const row = subs.find((r) => r.email === email);
            if (row && !row.unsubscribed_at) row.unsubscribed_at = "2026-01-01T00:00:00Z";
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO broadcasts/i.test(s)) { broadcasts.push(bound); return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          if (/FROM subscribers WHERE unsubscribed_at IS NULL/i.test(s)) {
            return { results: subs.filter((r) => !r.unsubscribed_at).map((r) => ({ email: r.email })) as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (/SUM\(CASE/i.test(s) && /unsubscribed_at IS NULL/i.test(s)) {
            return { active: subs.filter((r) => !r.unsubscribed_at).length,
                     unsubscribed: subs.filter((r) => r.unsubscribed_at).length } as T;
          }
          return null;
        },
      };
      return stmt;
    },
  };
  return api as unknown as import("@cloudflare/workers-types").D1Database;
}

describe("subscriber list helpers", () => {
  it("activeSubscribers excludes suppressed rows; counts split active/unsubscribed", async () => {
    const db = fakeDb();
    await recordSubscriber(db, "a@x.com", "landing");
    await recordSubscriber(db, "b@x.com", "landing");
    await unsubscribeSubscriber(db, "b@x.com");
    expect(await activeSubscribers(db)).toEqual([{ email: "a@x.com" }]);
    expect(await subscriberCounts(db)).toEqual({ active: 1, unsubscribed: 1 });
  });

  it("unsubscribeSubscriber is idempotent (second call no-throws)", async () => {
    const db = fakeDb();
    await recordSubscriber(db, "a@x.com", "landing");
    await unsubscribeSubscriber(db, "a@x.com");
    await unsubscribeSubscriber(db, "a@x.com");
    expect(await subscriberCounts(db)).toEqual({ active: 0, unsubscribed: 1 });
  });

  it("recordBroadcast returns an id", async () => {
    const db = fakeDb();
    const id = await recordBroadcast(db, { subject: "Launch", recipientCount: 3, sender: "owner" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
