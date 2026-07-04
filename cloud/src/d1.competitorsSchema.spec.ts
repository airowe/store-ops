/**
 * app_competitors (#72) — REAL-SCHEMA test: the helpers run against an
 * in-memory SQLite built from the actual schema.sql, so a query/schema
 * divergence fails here instead of in production (the #51 lesson). Also pins
 * the DEPLOY-ORDER guarantee: reads against a database where app_competitors
 * doesn't exist yet degrade to [] instead of crashing runs/the sweep.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmCompetitor,
  confirmedCompetitorKeys,
  deleteCompetitor,
  distinctTrackedKeywords,
  listCompetitors,
  upsertCompetitor,
} from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null; // Node < 22.5 (e.g. CI Node 20) — suite skips below.
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);

function d1From(sql: string): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(sql);
  return {
    prepare(stmtSql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          return (sqlite.prepare(stmtSql).get(...(bound as never[])) ?? null) as T | null;
        },
        async run() {
          const info = sqlite.prepare(stmtSql).run(...(bound as never[]));
          return { success: true, meta: { changes: Number(info.changes) } } as never;
        },
        async all<T>() {
          return { results: sqlite.prepare(stmtSql).all(...(bound as never[])) as T[] } as never;
        },
      };
      return stmt as never;
    },
  } as unknown as D1Database;
}

let db: D1Database;

beforeEach(async () => {
  if (!sqliteAvailable) return;
  db = d1From(readFileSync(SCHEMA_PATH, "utf8"));
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").bind().run();
  await db
    .prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES ('app-1', 'u1', 'com.x.y', 'X')")
    .bind()
    .run();
});

describe.skipIf(!sqliteAvailable)("app_competitors helpers against the real schema (#72)", () => {
  it("upsert → list round-trips; suggested and confirmed are both listed", async () => {
    await upsertCompetitor(db, { appId: "app-1", compKey: "111", name: "Rival A", source: "discovered", status: "suggested" });
    await upsertCompetitor(db, { appId: "app-1", compKey: "222", name: "Rival B", source: "user", status: "confirmed" });
    const rows = await listCompetitors(db, "app-1");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["confirmed", "suggested"]);
  });

  it("only CONFIRMED keys feed the watch list", async () => {
    await upsertCompetitor(db, { appId: "app-1", compKey: "111", name: "A", source: "discovered", status: "suggested" });
    await upsertCompetitor(db, { appId: "app-1", compKey: "222", name: "B", source: "user", status: "confirmed" });
    expect(await confirmedCompetitorKeys(db, "app-1")).toEqual(["222"]);
    await confirmCompetitor(db, "app-1", "111");
    expect((await confirmedCompetitorKeys(db, "app-1")).sort()).toEqual(["111", "222"]);
  });

  it("re-discovery NEVER downgrades a confirmation (name refreshes, status kept)", async () => {
    await upsertCompetitor(db, { appId: "app-1", compKey: "111", name: "Old Name", source: "user", status: "confirmed" });
    await upsertCompetitor(db, { appId: "app-1", compKey: "111", name: "New Name", source: "discovered", status: "suggested" });
    const rows = await listCompetitors(db, "app-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("confirmed"); // confirmation survives
    expect(rows[0]!.name).toBe("New Name"); // fresher listing name taken
  });

  it("delete removes the row and reports it; a ghost delete reports false", async () => {
    await upsertCompetitor(db, { appId: "app-1", compKey: "111", name: "A", source: "user", status: "confirmed" });
    expect(await deleteCompetitor(db, "app-1", "111")).toBe(true);
    expect(await listCompetitors(db, "app-1")).toEqual([]);
    expect(await deleteCompetitor(db, "app-1", "111")).toBe(false);
    expect(await confirmCompetitor(db, "app-1", "111")).toBe(false);
  });

  it("DEPLOY ORDER: reads on a DB without the table degrade to [] (no crash)", async () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    // strip the app_competitors table + its index from the schema
    const noTable = schema
      .replace(/CREATE TABLE IF NOT EXISTS app_competitors[\s\S]*?\);/, "")
      .replace(/CREATE INDEX IF NOT EXISTS idx_app_competitors[^;]*;/, "");
    const bare = d1From(noTable);
    expect(await listCompetitors(bare, "app-1")).toEqual([]);
    expect(await confirmedCompetitorKeys(bare, "app-1")).toEqual([]);
  });

  it("distinctTrackedKeywords: most recent first, de-duplicated, limited", async () => {
    const ins = (kw: string, at: string) =>
      db
        .prepare(
          "INSERT INTO rank_snapshots (id, app_id, keyword, rank, total, checked_at) VALUES (?, 'app-1', ?, 3, 200, ?)",
        )
        .bind(`${kw}-${at}`, kw, at)
        .run();
    await ins("old", "2026-01-01");
    await ins("mid", "2026-02-01");
    await ins("new", "2026-03-01");
    await ins("new", "2026-03-08"); // same keyword again — deduped
    expect(await distinctTrackedKeywords(db, "app-1", 2)).toEqual(["new", "mid"]);
  });
});
