/**
 * Rank cadence + daily snapshot persistence — REAL-SCHEMA regression (issue #94).
 *
 * The mock-D1 spec returns canned rows for ANY SQL, so it can't catch a query
 * that references a column the schema never declared. This builds a real
 * in-memory SQLite from the actual schema.sql and runs the real helpers through
 * it, so a missing `users.rank_cadence` column (or a malformed rank-snapshot
 * insert) fails loudly here instead of in production.
 *
 * Skips cleanly on Node < 22.5 (no node:sqlite), mirroring d1.agentPausedSchema.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getRankCadence,
  getRankHistory,
  persistRankSnapshots,
  setRankCadence,
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

function d1FromSchema(): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  function makeStmt(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
      // exposed so batch() can replay this statement's own bound args (not a
      // shared closure) — mirrors how real D1.batch executes each statement.
      _exec() {
        sqlite.prepare(sql).run(...(bound as never[]));
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
    return stmt;
  }
  return {
    prepare(sql: string) {
      return makeStmt(sql) as never;
    },
    async batch(stmts: Array<{ _exec: () => void }>) {
      for (const s of stmts) s._exec();
      return stmts.map(() => ({ success: true, meta: { changes: 1 } })) as never;
    },
  } as unknown as D1Database;
}

let db: D1Database;
beforeEach(() => {
  db = d1FromSchema();
});

describe.skipIf(!sqliteAvailable)("rank_cadence column (#94 regression)", () => {
  it("a freshly upserted user defaults to 'weekly'", async () => {
    const u = await upsertUser(db, "a@b.co");
    expect(u.rank_cadence).toBe("weekly");
    expect(await getRankCadence(db, u.id)).toBe("weekly");
  });

  it("setRankCadence round-trips through users.rank_cadence", async () => {
    const u = await upsertUser(db, "a@b.co");
    await setRankCadence(db, { userId: u.id, cadence: "daily" });
    expect(await getRankCadence(db, u.id)).toBe("daily");
    await setRankCadence(db, { userId: u.id, cadence: "weekly" });
    expect(await getRankCadence(db, u.id)).toBe("weekly");
  });
});

describe.skipIf(!sqliteAvailable)("persistRankSnapshots — writes dated rank rows, opens NO run", () => {
  async function seedApp() {
    const u = await upsertUser(db, "owner@b.co");
    await db
      .prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES (?, ?, ?, ?)")
      .bind("app-1", u.id, "com.x.y", "X")
      .run();
  }

  it("appends one rank_snapshots row per checked keyword (incl. honest null rank)", async () => {
    await seedApp();
    await persistRankSnapshots(db, {
      appId: "app-1",
      ranks: [
        { keyword: "yoga", rank: 12, foundName: "X", total: 200, limit: 200, error: "" },
        { keyword: "breathwork", rank: null, foundName: "", total: 180, limit: 200, error: "" },
      ],
    });

    const history = await getRankHistory(db, "app-1");
    expect(history).toHaveLength(2);
    const yoga = history.find((r) => r.keyword === "yoga")!;
    expect(yoga.rank).toBe(12);
    // honesty: unranked persists as a real NULL, never a fabricated number
    const bw = history.find((r) => r.keyword === "breathwork")!;
    expect(bw.rank).toBeNull();

    // opens NO run — the daily path is snapshot-only
    const runs = await db
      .prepare("SELECT COUNT(*) AS n FROM runs WHERE app_id = ?")
      .bind("app-1")
      .first<{ n: number }>();
    expect(runs!.n).toBe(0);
  });

  it("skips keywords whose fetch errored (never stores a fabricated row for them)", async () => {
    await seedApp();
    await persistRankSnapshots(db, {
      appId: "app-1",
      ranks: [
        { keyword: "ok", rank: 5, foundName: "X", total: 100, limit: 200, error: "" },
        { keyword: "boom", rank: null, foundName: "", total: 0, limit: 200, error: "HTTP 503" },
      ],
    });
    const history = await getRankHistory(db, "app-1");
    expect(history.map((r) => r.keyword)).toEqual(["ok"]);
  });
});
