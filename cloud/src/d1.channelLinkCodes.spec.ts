/**
 * channel_link_codes on the REAL composed schema (migration 0015).
 *
 * A link code is a bearer credential pasted into a chat log, so the two
 * properties that matter are SINGLE USE and EXPIRY. Both are asserted against
 * real SQLite rather than a mock, because a mock returning canned rows would
 * pass a consume() that forgot to delete and an expiry check that never fired.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createChannelLinkCode,
  consumeChannelLinkCode,
  sweepExpiredChannelLinkCodes,
  pendingChannelLinkCount,
  upsertUser,
} from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function d1(): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  function makeStmt(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { return (sqlite.prepare(sql).get(...(bound as never[])) ?? null) as T | null; },
      async run() { sqlite.prepare(sql).run(...(bound as never[])); return { success: true }; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] }; },
    };
    return stmt;
  }
  return { prepare: makeStmt } as unknown as D1Database;
}

async function seed() {
  const db = d1();
  const user = await upsertUser(db, "owner@example.com");
  return { db, userId: user.id };
}

describe.skipIf(!sqliteAvailable)("channel link codes", () => {
  it("mints a code that fits Telegram's 64-char base64url start payload", async () => {
    const { db, userId } = await seed();
    const code = await createChannelLinkCode(db, { userId, channel: "telegram" });
    expect(code.length).toBeLessThanOrEqual(64);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mints codes that differ", async () => {
    const { db, userId } = await seed();
    const a = await createChannelLinkCode(db, { userId, channel: "telegram" });
    const b = await createChannelLinkCode(db, { userId, channel: "telegram" });
    expect(a).not.toBe(b);
  });

  it("resolves a fresh code to the account and channel it was minted for", async () => {
    const { db, userId } = await seed();
    const code = await createChannelLinkCode(db, { userId, channel: "telegram", label: "Phone" });
    const claim = await consumeChannelLinkCode(db, code);
    expect(claim).toMatchObject({ userId, channel: "telegram", label: "Phone" });
  });

  it("IS SINGLE USE — a replayed code resolves to nothing", async () => {
    const { db, userId } = await seed();
    const code = await createChannelLinkCode(db, { userId, channel: "telegram" });
    await consumeChannelLinkCode(db, code);
    // A deep link lives in a chat log; anyone who scrolls back must not be able
    // to point the destination at themselves.
    await expect(consumeChannelLinkCode(db, code)).resolves.toBeNull();
  });

  it("REFUSES an expired code — enforced on read, not by a sweeper", async () => {
    const { db, userId } = await seed();
    const code = await createChannelLinkCode(db, {
      userId,
      channel: "telegram",
      ttlSeconds: 60,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const claim = await consumeChannelLinkCode(db, code, {
      now: () => new Date("2026-01-01T01:00:00Z"),
    });
    expect(claim).toBeNull();
  });

  it("REFUSES a code nobody minted", async () => {
    const { db } = await seed();
    await expect(consumeChannelLinkCode(db, "never-existed")).resolves.toBeNull();
  });

  it("REFUSES an empty code rather than matching a blank row", async () => {
    const { db } = await seed();
    await expect(consumeChannelLinkCode(db, "")).resolves.toBeNull();
  });

  it("reports how many codes are still pending, so a UI can say 'waiting'", async () => {
    const { db, userId } = await seed();
    expect(await pendingChannelLinkCount(db, userId)).toBe(0);
    const code = await createChannelLinkCode(db, { userId, channel: "telegram" });
    expect(await pendingChannelLinkCount(db, userId)).toBe(1);
    await consumeChannelLinkCode(db, code);
    expect(await pendingChannelLinkCount(db, userId)).toBe(0);
  });

  it("does not count an EXPIRED code as pending — a stale row is not a wait", async () => {
    const { db, userId } = await seed();
    await createChannelLinkCode(db, {
      userId,
      channel: "telegram",
      ttlSeconds: 60,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const later = { now: () => new Date("2026-01-01T02:00:00Z") };
    expect(await pendingChannelLinkCount(db, userId, later)).toBe(0);
  });

  it("sweeps expired rows as housekeeping, leaving fresh ones alone", async () => {
    const { db, userId } = await seed();
    await createChannelLinkCode(db, {
      userId,
      channel: "telegram",
      ttlSeconds: 60,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const fresh = await createChannelLinkCode(db, { userId, channel: "telegram" });
    await sweepExpiredChannelLinkCodes(db);
    // The fresh code still works — a sweep must never cost a live link.
    await expect(consumeChannelLinkCode(db, fresh)).resolves.toMatchObject({ userId });
  });
});
