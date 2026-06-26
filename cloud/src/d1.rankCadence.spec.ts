/**
 * Per-user rank cadence (issue #94) — the daily/weekly snapshot switch.
 *
 * Cadence is PER-USER, modeled exactly on `agent_paused` / `rlhf_opt_out`:
 *   setRankCadence  → UPDATE users SET rank_cadence = ? WHERE id = ?
 *   getRankCadence  → SELECT rank_cadence FROM users WHERE id = ?  (normalized)
 * The value is a string enum ('daily' | 'weekly'); 'weekly' is the default so a
 * missing/legacy row reads as 'weekly' — preserving today's behavior for everyone.
 *
 * Uses the same fake-D1 capture pattern as d1.agentPaused.spec.ts (SQL + bound
 * args). The real-schema column round-trip is pinned in d1.rankCadenceSchema.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { getRankCadence, setRankCadence } from "./d1.js";

type Captured = { sql: string; args: unknown[] };

function fakeDb(firstRows: Array<unknown> = []) {
  const captured: Captured[] = [];
  const queue = [...firstRows];
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          captured.push({ sql, args });
          return this;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async first<T>() {
          return (queue.shift() ?? null) as T | null;
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, captured };
}

const find = (captured: Captured[], re: RegExp) => captured.find((c) => re.test(c.sql));

describe("setRankCadence — writes the enum to users.rank_cadence", () => {
  it("UPDATE users SET rank_cadence = 'daily' WHERE id = ? when daily", async () => {
    const { db, captured } = fakeDb();
    await setRankCadence(db, { userId: "user-1", cadence: "daily" });

    const upd = find(captured, /UPDATE users SET rank_cadence/);
    expect(upd).toBeDefined();
    expect(upd!.args).toEqual(["daily", "user-1"]);
    // never touches the apps table on a per-user write
    expect(find(captured, /UPDATE apps/)).toBeUndefined();
  });

  it("writes 'weekly' when set back to weekly", async () => {
    const { db, captured } = fakeDb();
    await setRankCadence(db, { userId: "user-1", cadence: "weekly" });

    const upd = find(captured, /UPDATE users SET rank_cadence/);
    expect(upd!.args).toEqual(["weekly", "user-1"]);
  });
});

describe("getRankCadence — reads + normalizes to the enum", () => {
  it("returns 'daily' for a stored 'daily'", async () => {
    const { db } = fakeDb([{ rank_cadence: "daily" }]);
    expect(await getRankCadence(db, "user-1")).toBe("daily");
  });

  it("returns 'weekly' for a stored 'weekly'", async () => {
    const { db } = fakeDb([{ rank_cadence: "weekly" }]);
    expect(await getRankCadence(db, "user-1")).toBe("weekly");
  });

  it("defaults to 'weekly' when the row is missing (legacy / pre-migration)", async () => {
    const { db } = fakeDb([null]);
    expect(await getRankCadence(db, "ghost")).toBe("weekly");
  });

  it("defaults to 'weekly' when the column is null (pre-migration row)", async () => {
    const { db } = fakeDb([{ rank_cadence: null }]);
    expect(await getRankCadence(db, "user-1")).toBe("weekly");
  });
});
