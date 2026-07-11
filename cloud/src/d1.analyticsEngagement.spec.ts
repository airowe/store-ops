/**
 * Persistence for the Analytics Engagement series (analytics-reports Phase 2).
 * Idempotent upsert keyed by the dimension tuple (app/date/source/cpp/page_type)
 * so re-ingesting a day RESTATES it rather than duplicating — Apple revises
 * recent days. A metric the report didn't carry is stored as NULL, never 0.
 *
 * Fake D1 captures the SQL + bound args of every batched statement (the
 * d1.recordApproval.spec pattern) and answers reads from a canned result set.
 */
import { describe, expect, it } from "vitest";
import { getEngagementSeries, upsertEngagementRows } from "./d1.js";
import type { EngagementRow } from "./engine/analyticsEngagement.js";

type Captured = { sql: string; args: unknown[] };

function fakeDb(readRows: unknown[] = []) {
  const captured: Captured[] = [];
  let batched = 0;
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this; },
        async all<T>() { return { results: readRows as T[] }; },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      batched++;
      for (const s of stmts) captured.push({ sql: s.sql, args: s.args });
      return stmts.map(() => ({ success: true }));
    },
  };
  return { db: db as unknown as D1Database, captured, batches: () => batched };
}

describe("upsertEngagementRows", () => {
  it("upserts each row keyed by the dimension tuple; absent metric → NULL, absent dim → ''", async () => {
    const rows: EngagementRow[] = [
      { date: "2026-07-01", source: "App Store Search", cpp: "CPP_A", pageType: "Product Page", impressions: 100, productPageViews: 40, downloads: 8 },
      { date: "2026-07-01" }, // default page, no source, only present in the file with no metrics
    ];
    const { db, captured } = fakeDb();
    const n = await upsertEngagementRows(db, "app1", rows);

    expect(n).toBe(2);
    expect(captured).toHaveLength(2);
    for (const c of captured) {
      expect(c.sql).toMatch(/INSERT INTO analytics_engagement/);
      expect(c.sql).toMatch(/ON CONFLICT/i); // idempotent restate, not duplicate
    }
    // row 1 — full dimensions + metrics
    expect(captured[0]!.args).toEqual(["app1", "2026-07-01", "App Store Search", "CPP_A", "Product Page", 100, 40, 8]);
    // row 2 — empty dims default to '', absent metrics bind NULL (never 0)
    expect(captured[1]!.args).toEqual(["app1", "2026-07-01", "", "", "", null, null, null]);
  });

  it("no rows → no write at all (returns 0, batch never called)", async () => {
    const { db, batches } = fakeDb();
    expect(await upsertEngagementRows(db, "app1", [])).toBe(0);
    expect(batches()).toBe(0);
  });
});

describe("getEngagementSeries", () => {
  it("returns the app's series (typed), scoped to the app and ordered by date", async () => {
    const { db, captured } = fakeDb([
      { date: "2026-07-01", source: "", cpp: "", page_type: "", impressions: 100, product_page_views: 40, downloads: 8 },
    ]);
    // capture the read statement too
    const origPrepare = db.prepare.bind(db);
    (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      captured.push({ sql, args: [] });
      return origPrepare(sql);
    };

    const series = await getEngagementSeries(db, "app1");
    expect(series).toEqual([
      { date: "2026-07-01", source: "", cpp: "", pageType: "", impressions: 100, productPageViews: 40, downloads: 8 },
    ]);
    const read = captured.find((c) => /FROM analytics_engagement/.test(c.sql))!;
    expect(read.sql).toMatch(/WHERE app_id = \?/);
    expect(read.sql).toMatch(/ORDER BY date/i);
  });
});
