/**
 * notification_channels accessors on the REAL composed schema.
 *
 * The load-bearing test here is the verified-only filter: an unverified
 * destination must NEVER receive a notification. A mock returning canned rows
 * would happily "pass" a query that forgot the filter, so this builds real
 * SQLite and asserts on what actually comes back.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addNotificationChannel,
  deliverableDestinations,
  listNotificationChannels,
  markChannelDelivery,
  removeNotificationChannel,
  setNotificationChannelEnabled,
  upsertUser,
  verifyNotificationChannel,
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

describe.skipIf(!sqliteAvailable)("notification channels", () => {
  it("adds a destination UNVERIFIED by default", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    const [row] = await listNotificationChannels(db, userId);
    expect(row).toMatchObject({ channel: "telegram", address: "12345", enabled: true });
    expect(row!.verified).toBe(false);
  });

  it("EXCLUDES an unverified destination from delivery — the whole point", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await expect(deliverableDestinations(db, userId)).resolves.toEqual([]);
  });

  it("INCLUDES it once verified", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await verifyNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await expect(deliverableDestinations(db, userId)).resolves.toEqual([
      { channel: "telegram", address: "12345" },
    ]);
  });

  it("EXCLUDES a verified-but-muted destination, without unverifying it", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await verifyNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await setNotificationChannelEnabled(db, { userId, channel: "telegram", address: "12345", enabled: false });
    await expect(deliverableDestinations(db, userId)).resolves.toEqual([]);
    // muting must not cost proof of ownership — re-enabling should not re-verify
    const [row] = await listNotificationChannels(db, userId);
    expect(row!.verified).toBe(true);
  });

  it("never leaks another user's destinations", async () => {
    const { db, userId } = await seed();
    const other = await upsertUser(db, "someone-else@example.com");
    await addNotificationChannel(db, { userId: other.id, channel: "telegram", address: "999" });
    await verifyNotificationChannel(db, { userId: other.id, channel: "telegram", address: "999" });
    await expect(deliverableDestinations(db, userId)).resolves.toEqual([]);
  });

  it("re-adding the same destination UPDATES rather than duplicating (no double-send)", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345", label: "one" });
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345", label: "two" });
    const rows = await listNotificationChannels(db, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("two");
  });

  it("records a failure so a dead destination is visible, not a silent hole", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await verifyNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await markChannelDelivery(db, {
      userId, channel: "telegram", address: "12345",
      result: { ok: false, error: "chat not found" },
    });
    const [row] = await listNotificationChannels(db, userId);
    expect(row!.lastError).toBe("chat not found");
    expect(row!.lastFailedAt).toBeTruthy();
  });

  it("removes a destination", async () => {
    const { db, userId } = await seed();
    await addNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await removeNotificationChannel(db, { userId, channel: "telegram", address: "12345" });
    await expect(listNotificationChannels(db, userId)).resolves.toEqual([]);
  });
});
