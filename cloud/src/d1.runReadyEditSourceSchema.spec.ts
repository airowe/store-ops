/**
 * Migration 0013 — REAL-SCHEMA regression for the two columns the WebMCP entry
 * adds: users.email_run_ready (#493's missing notification) and
 * proposal_edits.source (RLHF provenance).
 *
 * Mock-D1 specs return canned rows for ANY SQL, so they cannot catch a column
 * that was never declared, nor a default that backfills wrongly. This builds a
 * real in-memory SQLite from schema.sql + every migration in order — the same
 * compose the deploy applies — and asserts the columns exist with the defaults
 * the migration's rationale depends on.
 *
 * Skips cleanly on Node < 22.5 (no node:sqlite), mirroring the sibling specs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
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
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  return sqlite;
}

type ColInfo = { name: string; dflt_value: unknown; notnull: number };
const cols = (db: import("node:sqlite").DatabaseSync, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColInfo[];

describe.skipIf(!sqliteAvailable)("migration 0013 — real composed schema", () => {
  it("adds users.email_run_ready, defaulted ON (#493: the queue is useless unheard)", () => {
    const db = realDb();
    const col = cols(db, "users").find((c) => c.name === "email_run_ready");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(String(col!.dflt_value)).toBe("1");
  });

  it("backfills email_run_ready ON for a user created before the column existed", () => {
    const db = realDb();
    db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u1", "a@example.com");
    const row = db.prepare("SELECT email_run_ready FROM users WHERE id = 'u1'").get() as {
      email_run_ready: number;
    };
    expect(row.email_run_ready).toBe(1);
  });

  it("adds proposal_edits.source, defaulted 'human'", () => {
    const db = realDb();
    const col = cols(db, "proposal_edits").find((c) => c.name === "source");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(String(col!.dflt_value).replace(/'/g, "")).toBe("human");
  });

  it("backfills source='human' — pre-WebMCP rows can only be human-sourced", () => {
    const db = realDb();
    db.prepare(
      "INSERT INTO proposal_edits (id, field, decision, edited, proposed_enc, final_enc) VALUES (?,?,?,?,?,?)",
    ).run("p1", "subtitle", "approved", 0, "enc", "enc");
    const row = db.prepare("SELECT source FROM proposal_edits WHERE id = 'p1'").get() as {
      source: string;
    };
    expect(row.source).toBe("human");
  });

  it("accepts 'agent-draft' — no CHECK, so post-judging sources need no rebuild", () => {
    const db = realDb();
    db.prepare(
      "INSERT INTO proposal_edits (id, field, decision, edited, proposed_enc, final_enc, source) VALUES (?,?,?,?,?,?,?)",
    ).run("p2", "subtitle", "approved", 0, "enc", "enc", "agent-draft");
    const row = db.prepare("SELECT source FROM proposal_edits WHERE id = 'p2'").get() as {
      source: string;
    };
    expect(row.source).toBe("agent-draft");
  });

  it("keeps proposal_edits ANONYMOUS — no user or app identifier is introduced", () => {
    const db = realDb();
    const names = cols(db, "proposal_edits").map((c) => c.name);
    expect(names).not.toContain("user_id");
    expect(names).not.toContain("app_id");
  });
});
