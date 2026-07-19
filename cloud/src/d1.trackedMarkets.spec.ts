/**
 * listTrackedMarkets (#180 Phase 2 — market-picker surface). The data layer
 * already scopes rank reads by storefront (getRankHistory { country }); the
 * missing piece is telling the UI WHICH markets have data. This returns the
 * distinct countries that have rank snapshots for an app, so a picker can be
 * populated from measured data (never a guessed list). Fake D1 captures the SQL
 * + bound args (the d1.perMarketRanks.spec pattern).
 */
import { describe, expect, it } from "vitest";
import { listTrackedMarkets } from "./d1.js";

function fakeDb(readRows: unknown[] = []) {
  const prepared: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
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
  };
  return { db: db as unknown as D1Database, prepared };
}

describe("listTrackedMarkets — distinct storefronts with measured rank data", () => {
  it("scopes the query to the app and reads distinct countries", async () => {
    const { db, prepared } = fakeDb([{ country: "us" }, { country: "jp" }, { country: "de" }]);
    const markets = await listTrackedMarkets(db, "app1");
    expect(prepared[0]!.sql).toMatch(/DISTINCT country/i);
    expect(prepared[0]!.sql).toMatch(/rank_snapshots/i);
    expect(prepared[0]!.args).toEqual(["app1"]);
    expect(markets).toEqual(["us", "jp", "de"]);
  });

  it("omits the legacy empty-country rows (only real storefronts)", async () => {
    // Phase 1 legacy rows persist country '' — those aren't a real market.
    const { db, prepared } = fakeDb([{ country: "us" }]);
    await listTrackedMarkets(db, "app1");
    expect(prepared[0]!.sql).toMatch(/country\s*(<>|!=)\s*''|country\s*!=\s*''/i);
  });

  it("returns [] for an app with no rank snapshots (no fabricated market)", async () => {
    const { db } = fakeDb([]);
    expect(await listTrackedMarkets(db, "app1")).toEqual([]);
  });

  it("normalizes/deduplicates and drops blanks defensively", async () => {
    // even if the DB returns a stray blank or mixed case, the result is clean
    const { db } = fakeDb([{ country: "US" }, { country: "" }, { country: "us" }, { country: "jp" }]);
    expect(await listTrackedMarkets(db, "app1")).toEqual(["us", "jp"]);
  });
});
