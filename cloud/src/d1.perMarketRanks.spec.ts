/**
 * Per-market rank tracking (#180 Phase 1) — rank_snapshots carry a `country`
 * storefront dimension so a localized push can PROVE movement in that market.
 * Fake D1 captures the SQL + bound args (the d1.analyticsEngagement.spec pattern)
 * so we assert country is persisted (lowercased) and reads scope by storefront.
 */
import { describe, expect, it } from "vitest";
import { getLatestRanks, getRankHistory, persistRankSnapshots } from "./d1.js";
import type { Rank } from "./engine/rankCheck.js";

type Captured = { sql: string; args: unknown[] };

function fakeDb(readRows: unknown[] = []) {
  const prepared: Captured[] = [];
  const batched: Captured[] = [];
  const db = {
    prepare(sql: string) {
      const stmt: { sql: string; args: unknown[]; bind(...a: unknown[]): unknown; all<T>(): Promise<{ results: T[] }> } = {
        sql,
        args: [],
        bind(...args: unknown[]) {
          this.args = args;
          prepared.push({ sql, args });
          return this;
        },
        async all<T>() {
          return { results: readRows as T[] };
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      for (const s of stmts) batched.push({ sql: s.sql, args: s.args });
      return stmts.map(() => ({ success: true }));
    },
  };
  return { db: db as unknown as D1Database, prepared, batched };
}

const rank = (keyword: string, rank: number | null): Rank => ({
  keyword,
  rank,
  foundName: "Demo",
  total: 200,
  limit: 200,
  error: "",
});

describe("persistRankSnapshots — per-market", () => {
  it("tags each row with the storefront, lowercased", async () => {
    const { db, batched } = fakeDb();
    await persistRankSnapshots(db, { appId: "app1", ranks: [rank("meal planner", 12)], country: "JP" });
    expect(batched).toHaveLength(1);
    expect(batched[0]!.sql).toContain("country");
    // id, app_id, keyword, rank, total, country, checked_at
    expect(batched[0]!.args[5]).toBe("jp");
  });

  it("defaults country to '' when omitted (legacy caller)", async () => {
    const { db, batched } = fakeDb();
    await persistRankSnapshots(db, { appId: "app1", ranks: [rank("radar", null)] });
    expect(batched[0]!.args[5]).toBe("");
  });

  it("still skips errored fetches (no fabricated row)", async () => {
    const { db, batched } = fakeDb();
    const errored: Rank = { ...rank("x", null), error: "timeout" };
    await persistRankSnapshots(db, { appId: "app1", ranks: [errored], country: "us" });
    expect(batched).toHaveLength(0);
  });
});

describe("getRankHistory — per-market scoping", () => {
  it("filters by storefront and selects the country column when country given", async () => {
    const { db, prepared } = fakeDb([]);
    await getRankHistory(db, "app1", { country: "JP" });
    const q = prepared[0]!;
    expect(q.sql).toContain("country = ?");
    expect(q.sql).toContain("country"); // selected back
    expect(q.args).toContain("jp"); // normalized
  });

  it("does NOT filter by country when omitted (all storefronts)", async () => {
    const { db, prepared } = fakeDb([]);
    await getRankHistory(db, "app1", {});
    expect(prepared[0]!.sql).not.toContain("country = ?");
  });

  it("combines keyword and country filters", async () => {
    const { db, prepared } = fakeDb([]);
    await getRankHistory(db, "app1", { keyword: "meal planner", country: "us" });
    const q = prepared[0]!;
    expect(q.sql).toContain("keyword = ?");
    expect(q.sql).toContain("country = ?");
    expect(q.args).toEqual(["app1", "meal planner", "us", 500]);
  });
});

describe("getLatestRanks — per-market scoping", () => {
  it("scopes both the inner and outer query to the storefront", async () => {
    const { db, prepared } = fakeDb([]);
    await getLatestRanks(db, "app1", "JP");
    const q = prepared[0]!;
    expect(q.sql.match(/country = \?/g)).toHaveLength(2); // inner + outer
    expect(q.args).toEqual(["app1", "jp", "app1", "jp"]);
  });

  it("keeps legacy all-storefronts behavior when country omitted", async () => {
    const { db, prepared } = fakeDb([]);
    await getLatestRanks(db, "app1");
    expect(prepared[0]!.sql).not.toContain("country = ?");
    expect(prepared[0]!.args).toEqual(["app1", "app1"]);
  });
});
