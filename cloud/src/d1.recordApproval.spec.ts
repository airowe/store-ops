/**
 * The approval gate must label HONESTLY. Approving a run does NOT push anything
 * to App Store Connect — it only reveals the (never-executed) push commands for
 * the human to run. So recordApproval must move the run to 'approved', NOT
 * 'shipped'. 'shipped' is reserved for a VERIFIED push that actually reached
 * Apple; setting it on approval overstates the product's headline claim.
 *
 * This pins the approval-sets-status path with a minimal fake D1 that captures
 * the SQL + bound args of every statement run through db.batch().
 */
import { describe, expect, it } from "vitest";
import { recordApproval } from "./d1.js";

type Captured = { sql: string; args: unknown[] };

/**
 * Fake D1 that records each prepared statement's SQL and the values bound to it.
 * Only the surface recordApproval touches (prepare → bind → batch) is modeled.
 */
function fakeDb() {
  const captured: Captured[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          return this;
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      for (const s of stmts) captured.push({ sql: s.sql, args: s.args });
      return stmts.map(() => ({ success: true }));
    },
  };
  return { db: db as unknown as D1Database, captured };
}

/** Pull the status value bound to the `UPDATE runs SET status = ?` statement. */
function statusUpdate(captured: Captured[]): unknown {
  const upd = captured.find((c) => /UPDATE runs SET status/.test(c.sql));
  return upd?.args[0];
}

describe("recordApproval — honest status labeling", () => {
  it("approve moves the run to 'approved' (NOT 'shipped' — nothing is pushed yet)", async () => {
    const { db, captured } = fakeDb();
    const row = await recordApproval(db, { runId: "run-1", decision: "approved" });

    expect(row.decision).toBe("approved");
    expect(statusUpdate(captured)).toBe("approved");
    // Approval never claims a real push happened.
    expect(statusUpdate(captured)).not.toBe("shipped");
  });

  it("reject moves the run to 'rejected'", async () => {
    const { db, captured } = fakeDb();
    const row = await recordApproval(db, { runId: "run-2", decision: "rejected" });

    expect(row.decision).toBe("rejected");
    expect(statusUpdate(captured)).toBe("rejected");
  });
});
