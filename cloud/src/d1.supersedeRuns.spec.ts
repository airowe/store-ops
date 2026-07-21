/**
 * Supersede stale awaiting_approval runs — REAL-SCHEMA regression.
 *
 * When persistRun writes a NEW awaiting_approval run for an app, any PRIOR
 * awaiting_approval run for that same app must flip to 'superseded' atomically —
 * so an iterated app never accumulates phantom "pending" runs (the funnel bug).
 * A DECIDED run (approved/rejected/shipped) is history and is never touched.
 *
 * Runs a real in-memory SQLite from schema.sql + migrations. Skips on Node < 22.5.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { persistRun, listRunsForApp } from "./d1.js";
import type { AgentResult } from "./engine/agent.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

function applyRealSchema(sqlite: import("node:sqlite").DatabaseSync): void {
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
}

function d1FromSchema(): { db: D1Database; raw: import("node:sqlite").DatabaseSync } {
  const sqlite = new DatabaseSync!(":memory:");
  applyRealSchema(sqlite);
  function makeStmt(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) { bound = args; return stmt; },
      _exec() { sqlite.prepare(sql).run(...(bound as never[])); },
      async first<T>() { return (sqlite.prepare(sql).get(...(bound as never[])) ?? null) as T | null; },
      async run() { sqlite.prepare(sql).run(...(bound as never[])); return { success: true, meta: { changes: 1 } } as never; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(bound as never[])) as T[] } as never; },
    };
    return stmt;
  }
  const db = {
    prepare(sql: string) { return makeStmt(sql) as never; },
    async batch(stmts: Array<{ _exec: () => void }>) {
      for (const s of stmts) s._exec();
      return stmts.map(() => ({ success: true, meta: { changes: 1 } })) as never;
    },
  } as unknown as D1Database;
  return { db, raw: sqlite };
}

/** A minimal AgentResult sufficient for persistRun. */
function result(name = "App"): AgentResult {
  return {
    audit: { app: name, bundleId: "com.x", screenshots: null, liveName: name },
    ranks: [],
    competitors: { digest: "", changes: [], listings: [] },
    reasoning: [],
    currentCopy: { name, subtitle: "", keywords: "" },
    proposedCopy: { name, subtitle: "s", keywords: "k", validation: { pass: true } },
    pushCommands: [],
  } as unknown as AgentResult;
}

const trig = { source: "manual" as const, reasons: [] };

describe.skipIf(!sqliteAvailable)("persistRun supersession", () => {
  let db: D1Database;
  let raw: import("node:sqlite").DatabaseSync;
  beforeEach(() => {
    ({ db, raw } = d1FromSchema());
    // an app row the runs FK needs
    raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1','a@b.co','2026-01-01')").run();
    raw.prepare("INSERT INTO apps (id, user_id, bundle_id, name, country, created_at) VALUES ('app1','u1','com.x','X','us','2026-01-01')").run();
  });

  function statuses(appId = "app1"): string[] {
    return (raw.prepare("SELECT status FROM runs WHERE app_id=? ORDER BY created_at").all(appId) as Array<{ status: string }>).map((r) => r.status);
  }

  it("a second awaiting_approval run supersedes the first for the same app", async () => {
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    const s = statuses();
    expect(s.filter((x) => x === "awaiting_approval")).toHaveLength(1); // only the newest is open
    expect(s.filter((x) => x === "superseded")).toHaveLength(1);
  });

  it("does NOT supersede a decided (approved/shipped) prior run", async () => {
    const r1 = await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    raw.prepare("UPDATE runs SET status='shipped' WHERE id=?").run(r1);
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    const s = statuses();
    expect(s).toContain("shipped"); // history preserved
    expect(s).not.toContain("superseded");
  });

  it("does not touch runs for a DIFFERENT app", async () => {
    raw.prepare("INSERT INTO apps (id, user_id, bundle_id, name, country, created_at) VALUES ('app2','u1','com.y','Y','us','2026-01-01')").run();
    await persistRun(db, { appId: "app2", status: "awaiting_approval", result: result(), trigger: trig });
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    expect(statuses("app2")).toEqual(["awaiting_approval"]); // untouched
  });

  it("the new run itself stays awaiting_approval (never self-superseded)", async () => {
    await persistRun(db, { appId: "app1", status: "awaiting_approval", result: result(), trigger: trig });
    const runs = await listRunsForApp(db, "app1");
    expect(runs[0]!.status).toBe("awaiting_approval");
  });
});

/** The migration's BACKFILL statement, applied to pre-existing stale rows. */
const BACKFILL_SQL = `
UPDATE runs SET status = 'superseded'
WHERE status = 'awaiting_approval'
  AND EXISTS (
    SELECT 1 FROM runs newer
    WHERE newer.app_id = runs.app_id
      AND newer.status = 'awaiting_approval'
      AND (newer.created_at > runs.created_at
           OR (newer.created_at = runs.created_at AND newer.id > runs.id))
  );`;

describe.skipIf(!sqliteAvailable)("migration backfill", () => {
  it("keeps only the newest awaiting_approval per app; supersedes the rest", () => {
    const { raw } = d1FromSchema();
    raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1','a@b.co','2026-01-01')").run();
    raw.prepare("INSERT INTO apps (id, user_id, bundle_id, name, country, created_at) VALUES ('app1','u1','com.x','X','us','2026-01-01')").run();
    // 3 stale awaiting_approval runs + 1 shipped (history), oldest→newest
    const ins = (id: string, status: string, at: string) =>
      raw.prepare("INSERT INTO runs (id, app_id, status, created_at, reasoning_json) VALUES (?, 'app1', ?, ?, '{}')").run(id, status, at);
    ins("r1", "awaiting_approval", "2026-07-01 08:00:00");
    ins("r2", "awaiting_approval", "2026-07-02 08:00:00");
    ins("r3", "shipped", "2026-07-03 08:00:00");
    ins("r4", "awaiting_approval", "2026-07-04 08:00:00"); // newest open — survives

    raw.exec(BACKFILL_SQL);

    const byId = Object.fromEntries(
      (raw.prepare("SELECT id, status FROM runs").all() as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]),
    );
    expect(byId.r1).toBe("superseded");
    expect(byId.r2).toBe("superseded");
    expect(byId.r3).toBe("shipped"); // decided run untouched
    expect(byId.r4).toBe("awaiting_approval"); // newest open survives
  });
});
