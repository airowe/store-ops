/**
 * app_settings / thresholds (#53) — REAL-SCHEMA test (node:sqlite over the
 * actual schema.sql). Pins the fail-open read (missing row AND missing table →
 * defaults) and the merge-write round-trip.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { getThresholds, setThresholds } from "./d1.js";
import { DEFAULT_THRESHOLDS } from "./thresholds.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
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

describe.skipIf(!sqliteAvailable)("thresholds against the real schema (#53)", () => {
  it("missing row → defaults (fail-open, today's behavior)", async () => {
    expect(await getThresholds(db, "app-1")).toEqual(DEFAULT_THRESHOLDS);
  });

  it("DEPLOY ORDER: missing table → defaults, no crash", async () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const noTable = schema.replace(/CREATE TABLE IF NOT EXISTS app_settings[\s\S]*?\);/, "");
    expect(await getThresholds(d1From(noTable), "app-1")).toEqual(DEFAULT_THRESHOLDS);
  });

  it("partial patches MERGE and round-trip", async () => {
    await setThresholds(db, "app-1", { rankDropAtLeast: 10 });
    await setThresholds(db, "app-1", { mutedKeywords: ["pantry"], notifyOnly: true });
    expect(await getThresholds(db, "app-1")).toEqual({
      ...DEFAULT_THRESHOLDS,
      rankDropAtLeast: 10,
      mutedKeywords: ["pantry"],
      notifyOnly: true,
    });
  });

  it("garbage in the stored column reads as defaults (fail-open)", async () => {
    await db
      .prepare("INSERT INTO app_settings (app_id, threshold_json) VALUES ('app-1', 'not json')")
      .bind()
      .run();
    expect(await getThresholds(db, "app-1")).toEqual(DEFAULT_THRESHOLDS);
  });
});
