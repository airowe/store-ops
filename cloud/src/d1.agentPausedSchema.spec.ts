/**
 * Agent pause/resume — REAL-SCHEMA regression test (issue #51).
 *
 * The mock-D1 spec (d1.agentPaused.spec.ts) returns canned rows for ANY SQL, so
 * it can't catch a query that references a column the schema never declared. The
 * shipped per-app `isAgentPaused`/`setAgentPaused` did exactly that — they read
 * `apps.agent_paused`, but the migration only added `agent_paused` to `users`.
 * Against a real DB that throws `no such column: a.agent_paused`, crashing the
 * weekly cron (which calls isAgentPaused with an appId) for every app, every run.
 *
 * This spec builds a real in-memory SQLite from the actual schema.sql and runs
 * the real helpers through it, so any query/schema divergence fails loudly here
 * instead of in production. Uses node:sqlite (Node 22+) behind a tiny adapter
 * exposing just the D1 surface the helpers touch (prepare → bind → first/run).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { isAgentPaused, setAgentPaused } from "./d1.js";

// `node:sqlite` is a Node builtin only from 22.5+ (stable in 24/26). CI runs on
// Node 20, where requiring it throws ERR_UNKNOWN_BUILTIN_MODULE. So load it
// LAZILY behind a guard: when present (a dev on Node 22.5+/24/26) this suite runs
// the real-schema regression; when absent (CI Node 20) it cleanly SKIPS rather
// than crashing the whole test run. The mock-based d1.agentPaused.spec.ts still
// runs everywhere — this is the extra, environment-gated layer.
// createRequire defers to Node's real loader (Vite's resolver mangles the
// `node:sqlite` specifier otherwise).
let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null; // Node < 22.5 (e.g. CI Node 20) — suite skips below.
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);

/**
 * Minimal D1Database adapter over node:sqlite — only prepare/bind/first/run, the
 * surface these helpers use. Real SQL hits a real schema, so a missing column
 * throws exactly as production D1 would.
 */
function d1FromSchema(): D1Database {
  // Guarded by sqliteAvailable / describe.skipIf — never reached on Node < 22.5.
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...(bound as never[])) ?? null) as T | null;
        },
        async run() {
          sqlite.prepare(sql).run(...(bound as never[]));
          return { success: true, meta: { changes: 1 } } as never;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
  } as unknown as D1Database;
}

let db: D1Database;

beforeEach(() => {
  db = d1FromSchema();
});

/** Insert a user + (optionally) an app directly, returning their ids. */
async function seed(opts: { userPaused?: boolean; withApp?: boolean } = {}) {
  await db
    .prepare("INSERT INTO users (id, email, agent_paused) VALUES (?, ?, ?)")
    .bind("user-1", "a@b.co", opts.userPaused ? 1 : 0)
    .run();
  if (opts.withApp) {
    await db
      .prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES (?, ?, ?, ?)")
      .bind("app-1", "user-1", "com.x.y", "X")
      .run();
  }
}

describe.skipIf(!sqliteAvailable)("isAgentPaused against the real schema (#51 regression)", () => {
  it("per-user: reads users.agent_paused (true when 1)", async () => {
    await seed({ userPaused: true });
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(true);
  });

  it("per-user: false when 0", async () => {
    await seed({ userPaused: false });
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(false);
  });

  // The load-bearing one: the cron calls this with an appId on EVERY app. It must
  // not reference a column the apps table doesn't have.
  it("per-app: resolves through the app's owner WITHOUT crashing (the cron path)", async () => {
    await seed({ userPaused: true, withApp: true });
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(true);
  });

  it("per-app: not paused when the owner isn't paused", async () => {
    await seed({ userPaused: false, withApp: true });
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(false);
  });

  it("per-app: a missing app is not paused (no row → not paused, no throw)", async () => {
    await seed({ userPaused: true, withApp: false });
    expect(await isAgentPaused(db, { userId: "user-1", appId: "ghost" })).toBe(false);
  });
});

describe.skipIf(!sqliteAvailable)("setAgentPaused against the real schema (#51 regression)", () => {
  it("per-user write round-trips through users.agent_paused", async () => {
    await seed();
    await setAgentPaused(db, { userId: "user-1", paused: true });
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(true);
    await setAgentPaused(db, { userId: "user-1", paused: false });
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(false);
  });
});
