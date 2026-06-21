/**
 * Agent pause/resume persistence (issue #51) — the standing-autonomy off switch.
 *
 * `setAgentPaused` must write the boolean as SQLite's 0/1 to the RIGHT scope:
 *   • per-user  → UPDATE users SET agent_paused = ? WHERE id = ?
 *   • per-app   → UPDATE apps  SET agent_paused = ? WHERE id = ?   (additive scope)
 *
 * `isAgentPaused` must READ + NORMALIZE the 0/1 column to a real boolean, and —
 * for the per-app variant — treat the target as paused when EITHER the app OR its
 * owner is paused (so a per-user master switch silences everything the user owns).
 *
 * Both use the same fake-D1 capture pattern as d1.recordApproval.spec.ts.
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

  it("per-app: UPDATE apps SET agent_paused = ? WHERE id = ? when given an appId", async () => {
    const { db, captured } = fakeDb();
    await setAgentPaused(db, { appId: "app-9", paused: true });

    const upd = find(captured, /UPDATE apps SET agent_paused/);
    expect(upd).toBeDefined();
    expect(upd!.args).toEqual([1, "app-9"]);
    expect(find(captured, /UPDATE users/)).toBeUndefined();
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

  it("per-app: paused when the OWNER is paused even if the app is not", async () => {
    // The single query OR-folds app + owner; the fake returns the folded result.
    const { db } = fakeDb([{ paused: 1 }]);
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(true);
  });

  it("per-app: not paused when neither the app nor the owner is paused", async () => {
    const { db } = fakeDb([{ paused: 0 }]);
    expect(await isAgentPaused(db, { userId: "user-1", appId: "app-1" })).toBe(false);
  });
});
