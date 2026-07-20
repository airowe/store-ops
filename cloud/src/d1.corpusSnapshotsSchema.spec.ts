/**
 * corpus_snapshots — REAL-SCHEMA regression (#63). Builds an in-memory SQLite
 * from the actual schema.sql + migrations and runs persistCorpusSnapshots through
 * it, so a column the INSERT names but the DDL never declared (or a null-rank
 * mishandling) fails loudly here instead of in production.
 *
 * Skips cleanly on Node < 22.5 (no node:sqlite), mirroring the other *Schema specs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { persistCorpusSnapshots, readCorpusPoints, type CorpusRow } from "./d1.js";

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
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
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
  const db = {
    prepare(sql: string) {
      return makeStmt(sql) as never;
    },
    async batch(stmts: Array<{ _exec: () => void }>) {
      for (const s of stmts) s._exec();
      return stmts.map(() => ({ success: true, meta: { changes: 1 } })) as never;
    },
  } as unknown as D1Database;
  return { db, raw: sqlite };
}

function corpusRow(p: Partial<CorpusRow> = {}): CorpusRow {
  return {
    seedKeyword: "weather",
    country: "us",
    bundleId: "com.example.weather",
    trackId: 111,
    name: "Weatherly",
    categoryId: "6001",
    categoryName: "Weather",
    rank: 1,
    version: "2.1.0",
    rating: 4.6,
    ratingCount: 1200,
    description: "Honest forecasts.",
    ...p,
  };
}

describe.skipIf(!sqliteAvailable)("corpus_snapshots schema (#63)", () => {
  let db: D1Database;
  let raw: import("node:sqlite").DatabaseSync;
  beforeEach(() => {
    ({ db, raw } = d1FromSchema());
  });

  it("persists a batch and every named column round-trips", async () => {
    await persistCorpusSnapshots(db, [corpusRow(), corpusRow({ bundleId: "com.b", rank: 2 })]);
    const rows = raw.prepare("SELECT * FROM corpus_snapshots ORDER BY rank").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.seed_keyword).toBe("weather");
    expect(rows[0]!.bundle_id).toBe("com.example.weather");
    expect(rows[0]!.category_id).toBe("6001");
    expect(rows[0]!.rating).toBe(4.6);
    expect(rows[0]!.checked_at).toBeTruthy();
  });

  it("persists a null rank honestly (beyond the cap, not a fake 0)", async () => {
    await persistCorpusSnapshots(db, [corpusRow({ rank: null })]);
    const row = raw.prepare("SELECT rank FROM corpus_snapshots").get() as { rank: number | null };
    expect(row.rank).toBeNull();
  });

  it("persists null rating/ratingCount (absent, not a fake 0)", async () => {
    await persistCorpusSnapshots(db, [corpusRow({ rating: null, ratingCount: null })]);
    const row = raw.prepare("SELECT rating, rating_count FROM corpus_snapshots").get() as { rating: number | null; rating_count: number | null };
    expect(row.rating).toBeNull();
    expect(row.rating_count).toBeNull();
  });

  it("empty batch is a no-op", async () => {
    await persistCorpusSnapshots(db, []);
    const count = raw.prepare("SELECT COUNT(*) AS n FROM corpus_snapshots").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("readCorpusPoints scopes by seed and maps snake_case → CorpusPoint shape", async () => {
    await persistCorpusSnapshots(db, [
      corpusRow({ seedKeyword: "weather", bundleId: "com.w" }),
      corpusRow({ seedKeyword: "budget", bundleId: "com.b" }),
    ]);
    const weather = await readCorpusPoints(db, { seedKeyword: "weather" });
    expect(weather).toHaveLength(1);
    expect(weather[0]!.bundleId).toBe("com.w");
    expect(weather[0]!.seedKeyword).toBe("weather");
    expect(weather[0]!.checkedAt).toBeTruthy();
  });

  it("readCorpusPoints orders by (seed, bundle, checked_at) so transitions can pair", async () => {
    // two dated snapshots of one app — must come back oldest-first, adjacent
    await persistCorpusSnapshots(db, [corpusRow({ bundleId: "com.a", rank: 8 })]);
    // force a later checked_at by inserting a second row with an explicit newer time
    raw
      .prepare(
        "INSERT INTO corpus_snapshots (id, seed_keyword, country, bundle_id, name, category_id, category_name, rank, version, rating, rating_count, description, checked_at) VALUES ('x2','weather','us','com.a','Weatherly','6001','Weather',3,'2.2.0',4.6,1200,'d','2026-07-05 08:00:00')",
      )
      .run();
    const pts = await readCorpusPoints(db, { seedKeyword: "weather" });
    const forApp = pts.filter((p) => p.bundleId === "com.a");
    expect(forApp).toHaveLength(2);
    expect(forApp[0]!.checkedAt <= forApp[1]!.checkedAt).toBe(true);
  });
});
