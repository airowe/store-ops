/**
 * Communication prefs at the d1 layer, on the REAL composed schema
 * (schema.sql + migrations). Covers email_run_ready (migration 0013, #493)
 * alongside the existing email_digest / push_run_ready toggles.
 *
 * Real SQLite rather than a mock: the whole risk with a prefs column is that it
 * is read with a name the schema never declared, which a canned-row mock cannot
 * catch. Skips cleanly on Node < 22.5, mirroring the sibling schema specs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getNotificationPrefs, setNotificationPrefs, upsertUser } from "./d1.js";

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

describe.skipIf(!sqliteAvailable)("notification prefs", () => {
  it("defaults a new user to run-ready email ON (#493: a silent queue is the bug)", async () => {
    const db = d1();
    const u = await upsertUser(db, "a@example.com");
    await expect(getNotificationPrefs(db, u.id)).resolves.toMatchObject({
      email_run_ready: true,
      email_digest: "weekly",
      push_run_ready: true,
    });
  });

  it("turns run-ready email off without touching the weekly digest", async () => {
    const db = d1();
    const u = await upsertUser(db, "b@example.com");
    await setNotificationPrefs(db, { userId: u.id, email_run_ready: false });
    const prefs = await getNotificationPrefs(db, u.id);
    expect(prefs.email_run_ready).toBe(false);
    // the two prefs answer different questions and must not be coupled
    expect(prefs.email_digest).toBe("weekly");
  });

  it("silences the weekly digest without silencing run-ready", async () => {
    const db = d1();
    const u = await upsertUser(db, "c@example.com");
    await setNotificationPrefs(db, { userId: u.id, email_digest: "off" });
    const prefs = await getNotificationPrefs(db, u.id);
    expect(prefs.email_digest).toBe("off");
    expect(prefs.email_run_ready).toBe(true);
  });

  it("round-trips back on", async () => {
    const db = d1();
    const u = await upsertUser(db, "d@example.com");
    await setNotificationPrefs(db, { userId: u.id, email_run_ready: false });
    await setNotificationPrefs(db, { userId: u.id, email_run_ready: true });
    await expect(getNotificationPrefs(db, u.id)).resolves.toMatchObject({ email_run_ready: true });
  });
});
