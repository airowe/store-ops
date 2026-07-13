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
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getPlayChartRankHistory,
  getRankCadence,
  getRankHistory,
  persistPlayChartRank,
  persistRankSnapshots,
  setRankCadence,
  upsertUser,
} from "./d1.js";
import type { PlayChartRank } from "./engine/index.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;

const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

/** A real DB = the schema.sql BASELINE + the migrations/ increments, in order —
 *  the same compose the deploy applies (schema.sql is the pre-migration baseline;
 *  migration-owned columns like rank_snapshots.country come from a migration, not
 *  the CREATE). Applying only schema.sql would miss those columns. */
function applyRealSchema(sqlite: import("node:sqlite").DatabaseSync): void {
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
}

function d1FromSchema(): D1Database {
  const sqlite = new DatabaseSync!(":memory:");
  applyRealSchema(sqlite);
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

describe.skipIf(!sqliteAvailable)("persistPlayChartRank — Play chart rank time series (parity step 1)", () => {
  async function seedApp() {
    const u = await upsertUser(db, "owner@b.co");
    await db
      .prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES (?, ?, ?, ?)")
      .bind("app-1", u.id, "com.x.y", "X")
      .run();
  }
  const ranked: PlayChartRank = {
    collection: "TOP_FREE",
    category: "WEATHER",
    country: "us",
    outOf: 100,
    ranked: true,
    position: 7,
  };
  const notCharting: PlayChartRank = {
    collection: "TOP_FREE",
    category: "WEATHER",
    country: "us",
    outOf: 100,
    ranked: false,
  };

  it("persists a measured ranked position, readable as a series", async () => {
    await seedApp();
    await persistPlayChartRank(db, { appId: "app-1", packageName: "com.x.y", rank: ranked });
    const hist = await getPlayChartRankHistory(db, "app-1", { category: "WEATHER" });
    expect(hist).toHaveLength(1);
    expect(hist[0]!.position).toBe(7);
    expect(hist[0]!.out_of).toBe(100);
    expect(hist[0]!.country).toBe("us");
  });

  it("persists 'not charting' as a real NULL position (honest, not a fake number)", async () => {
    await seedApp();
    await persistPlayChartRank(db, { appId: "app-1", packageName: "com.x.y", rank: notCharting });
    const hist = await getPlayChartRankHistory(db, "app-1");
    expect(hist).toHaveLength(1);
    expect(hist[0]!.position).toBeNull();
  });

  it("an UNKNOWN (null) read persists NOTHING", async () => {
    await seedApp();
    await persistPlayChartRank(db, { appId: "app-1", packageName: "com.x.y", rank: null });
    expect(await getPlayChartRankHistory(db, "app-1")).toEqual([]);
  });
});
