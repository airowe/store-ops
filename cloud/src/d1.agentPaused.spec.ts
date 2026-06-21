/**
 * Agent pause/resume persistence (issue #51) — the standing-autonomy off switch.
 *
 * Pause is PER-USER: `setAgentPaused` writes the boolean as SQLite's 0/1 to
 *   users.agent_paused  (UPDATE users SET agent_paused = ? WHERE id = ?)
 * and `isAgentPaused` reads + normalizes that 0/1 back to a real boolean. The
 * cron also calls isAgentPaused with an `appId`; that resolves the app to its
 * OWNER and reads the same per-user flag (a per-app override is an additive
 * follow-up — there is no apps.agent_paused column today).
 *
 * These tests use the fake-D1 capture pattern (SQL + bound args) for the SQL
 * shape. The real-schema behavior (incl. the appId→owner JOIN that must not
 * reference a nonexistent column) is pinned separately in
 * d1.agentPausedSchema.spec.ts against an actual SQLite built from schema.sql.
 */
import { describe, expect, it } from "vitest";
import { isAgentPaused, setAgentPaused } from "./d1.js";

type Captured = { sql: string; args: unknown[] };

/**
 * Fake D1 that records each statement's SQL + bound args, and answers `.first()`
 * from a queue of canned rows (one per prepared SELECT, in order). Models only
 * the surface these helpers touch: prepare → bind → run / first.
 */
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

describe("setAgentPaused — writes 0/1 to the right scope", () => {
  it("per-user: UPDATE users SET agent_paused = 1 WHERE id = ? when paused", async () => {
    const { db, captured } = fakeDb();
    await setAgentPaused(db, { userId: "user-1", paused: true });

    const upd = find(captured, /UPDATE users SET agent_paused/);
    expect(upd).toBeDefined();
    expect(upd!.args).toEqual([1, "user-1"]);
    // never touches the apps table on a per-user write
    expect(find(captured, /UPDATE apps/)).toBeUndefined();
  });

  it("per-user: writes 0 when resuming (paused:false)", async () => {
    const { db, captured } = fakeDb();
    await setAgentPaused(db, { userId: "user-1", paused: false });

    const upd = find(captured, /UPDATE users SET agent_paused/);
    expect(upd!.args).toEqual([0, "user-1"]);
  });

  it("never writes the apps table (pause is per-user; no apps.agent_paused column)", async () => {
    const { db, captured } = fakeDb();
    await setAgentPaused(db, { userId: "user-1", paused: true });
    expect(find(captured, /UPDATE apps/)).toBeUndefined();
  });
});

describe("isAgentPaused — reads + normalizes 0/1 to boolean", () => {
  it("returns true for a stored 1 (per-user)", async () => {
    const { db } = fakeDb([{ agent_paused: 1 }]);
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(true);
  });

  it("returns false for a stored 0 (per-user)", async () => {
    const { db } = fakeDb([{ agent_paused: 0 }]);
    expect(await isAgentPaused(db, { userId: "user-1" })).toBe(false);
  });

  it("returns false when the user row is missing (no flag → not paused)", async () => {
    const { db } = fakeDb([null]);
    expect(await isAgentPaused(db, { userId: "ghost" })).toBe(false);
  });

  // The appId variant resolves the app to its owner and reads users.agent_paused
  // (column aliased back to agent_paused). Real JOIN behavior + the
  // must-not-reference-apps.agent_paused invariant live in the schema spec.
  it("per-app: paused when the owner is paused (resolved via the app→owner join)", async () => {
    const { db } = fakeDb([{ agent_paused: 1 }]);
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(true);
  });

  it("per-app: not paused when the owner is not paused", async () => {
    const { db } = fakeDb([{ agent_paused: 0 }]);
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(false);
  });
});
