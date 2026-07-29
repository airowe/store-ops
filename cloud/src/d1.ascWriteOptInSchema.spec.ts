/**
 * #374: `users.asc_write_opt_in` — the user's OWN consent to ShipASO performing
 * App Store Connect writes (screenshot upload, PPO experiment, CPP create).
 *
 * The default is the whole point. `canAscWrite(tier)` answers "is this
 * capability available on your plan"; it must never answer "should we write".
 * Subscribing is a purchase decision, not permission to mutate a live listing
 * with a borrowed credential — so an upgrade must not silently enable outward
 * writes, and every existing paid user must land opted OUT.
 *
 * Asserted against the REAL composed schema (schema.sql baseline + every
 * migration in order, exactly what the deploy applies) rather than a hand-built
 * table, so the migration itself is what is under test.
 */
import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function realDb(): import("node:sqlite").DatabaseSync {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  return sqlite;
}

const cols = (sqlite: import("node:sqlite").DatabaseSync) =>
  (sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string; dflt_value: unknown }>);

describe.skipIf(!sqliteAvailable)("users.asc_write_opt_in (#374)", () => {
  it("exists after the real schema + migration compose", () => {
    const names = cols(realDb()).map((c) => c.name);
    expect(names).toContain("asc_write_opt_in");
  });

  /**
   * The consent guarantee. If this ever defaults to 1, every existing paid user
   * is opted in to outward writes they never chose.
   */
  it("defaults to 0 — opting in is an ACTION, never a side effect of upgrading", () => {
    const col = cols(realDb()).find((c) => c.name === "asc_write_opt_in");
    expect(col, "column missing").toBeDefined();
    expect(String(col!.dflt_value)).toBe("0");
  });

  it("a newly created user is opted OUT", () => {
    const db = realDb();
    db.exec(
      "INSERT INTO users (id, email) VALUES ('u-new', 'new@example.com')",
    );
    const row = db.prepare("SELECT asc_write_opt_in FROM users WHERE id='u-new'").get() as {
      asc_write_opt_in: number;
    };
    expect(row.asc_write_opt_in).toBe(0);
  });

  /**
   * The migration must be back-fillable onto a table that already has rows —
   * an existing paid user must not be opted in by the upgrade itself.
   */
  it("leaves pre-existing users opted out", () => {
    const db = realDb();
    db.exec("INSERT INTO users (id, email, tier) VALUES ('u-old', 'old@example.com', 'scale')");
    const row = db.prepare("SELECT asc_write_opt_in FROM users WHERE id='u-old'").get() as {
      asc_write_opt_in: number;
    };
    expect(row.asc_write_opt_in, "a paid user must not be opted in by default").toBe(0);
  });

  it("fails CLOSED for an unknown user (getAscWriteOptIn)", async () => {
    // A missing row must read as "no consent", never as consent.
    const { getAscWriteOptIn } = await import("./d1.js");
    const fake = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    expect(await getAscWriteOptIn(fake, "nobody")).toBe(false);
  });

  it("round-trips an explicit opt-in", () => {
    const db = realDb();
    db.exec("INSERT INTO users (id, email) VALUES ('u1', 'a@b.c')");
    db.exec("UPDATE users SET asc_write_opt_in = 1 WHERE id='u1'");
    const row = db.prepare("SELECT asc_write_opt_in FROM users WHERE id='u1'").get() as {
      asc_write_opt_in: number;
    };
    expect(row.asc_write_opt_in).toBe(1);
  });

  /**
   * Guards the mistake made (and caught) while writing this migration: the
   * column defined in BOTH schema.sql and the migration fails the composed
   * apply with "duplicate column name".
   */
  it("is declared in the migration only, never in the schema baseline", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const declared = /^\s*asc_write_opt_in\s+INTEGER/m.test(schema);
    expect(declared, "asc_write_opt_in must not be declared in schema.sql").toBe(false);
  });
});
