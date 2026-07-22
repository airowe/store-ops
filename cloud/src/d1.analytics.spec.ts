/**
 * Analytics commerce/usage/header-capture persistence (Task 5). Runs against a
 * REAL node:sqlite in-memory DB built from schema.sql + migration
 * 0007_analytics_commerce_usage.sql (not `cloudflare:test` — this repo doesn't
 * wire the workers vitest pool for the default suite). Mirrors the d1From
 * pattern used for webhook secret storage.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { getCommerceSeries, getUsageSeries, recordReportHeaders, upsertCommerceRows, upsertUsageRows } from "./d1.js";

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const sqliteAvailable = DatabaseSync !== null;
const SCHEMA_PATH = fileURLToPath(new URL("../schema.sql", import.meta.url).href);
const MIGRATION_PATH = fileURLToPath(new URL("../migrations/0007_analytics_commerce_usage.sql", import.meta.url).href);

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
    async batch(stmts: unknown[]) {
      return Promise.all((stmts as { run: () => Promise<unknown> }[]).map((s) => s.run()));
    },
  } as unknown as D1Database;
}

let db: D1Database;
beforeEach(async () => {
  if (!sqliteAvailable) return;
  const sql = readFileSync(SCHEMA_PATH, "utf8") + "\n" + readFileSync(MIGRATION_PATH, "utf8");
  db = d1From(sql);
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").bind().run();
  await db.prepare("INSERT INTO apps (id, user_id, bundle_id, name) VALUES ('app-1','u1','com.x.y','X')").bind().run();
});

describe.skipIf(!sqliteAvailable)("analytics commerce/usage persistence", () => {
  it("upserts + reads commerce rows, preserving NULL metrics (no fake 0)", async () => {
    await upsertCommerceRows(db, "app-1", [{ date: "2026-07-01", contentName: "Pro", proceeds: 70 }]);
    const series = await getCommerceSeries(db, "app-1");
    expect(series).toEqual([{ date: "2026-07-01", contentName: "Pro", purchaseType: "", sales: null, proceeds: 70, payingUsers: null }]);
  });

  it("upsert is idempotent on the conflict key", async () => {
    await upsertCommerceRows(db, "app-1", [{ date: "2026-07-01", contentName: "Pro", proceeds: 70 }]);
    await upsertCommerceRows(db, "app-1", [{ date: "2026-07-01", contentName: "Pro", proceeds: 80 }]);
    const series = await getCommerceSeries(db, "app-1");
    expect(series.length).toBe(1);
    expect(series[0]!.proceeds).toBe(80);
  });

  it("upserts + reads usage rows with the verified crash cols", async () => {
    await upsertUsageRows(db, "app-1", [{ date: "2026-07-01", appVersion: "3.1.0", device: "iPhone", crashes: 4, uniqueDevices: 3 }]);
    const series = await getUsageSeries(db, "app-1");
    expect(series[0]!.crashes).toBe(4);
    expect(series[0]!.uniqueDevices).toBe(3);
    expect(series[0]!.sessions).toBeNull();
  });

  it("recordReportHeaders captures a raw header row (idempotent)", async () => {
    await recordReportHeaders(db, { appId: "app-1", category: "COMMERCE", header: "Date\tProceeds" });
    await recordReportHeaders(db, { appId: "app-1", category: "COMMERCE", header: "Date\tProceeds" });
    const { results } = await db.prepare("SELECT * FROM analytics_report_headers WHERE app_id = 'app-1'").bind().all();
    expect(results!.length).toBe(1);
  });
});
