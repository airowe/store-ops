/**
 * `updateRunCopy` rewrites a run's finalized copy at approval time (#39 Part 1,
 * approach (a) from the PRD). When the human edits the proposal and approves, the
 * server re-derives the push commands and persists the EDITED copy onto the run's
 * trace (`reasoning_json.proposedCopy` + `.pushCommands`) and the normalized
 * `proposals` rows — so every downstream handoff (push-commands / fastlane / PR /
 * ASC push) reads the edited values with ZERO route changes.
 *
 * This pins, with a minimal fake D1:
 *  - the rewritten trace keeps everything else intact, only swapping proposedCopy +
 *    pushCommands (additive, never a destructive trace rewrite),
 *  - the proposals rows are replaced (DELETE then INSERT) with the final values +
 *    char counts,
 *  - it all runs in ONE atomic batch.
 */
import { describe, expect, it } from "vitest";
import { updateRunCopy } from "./d1.js";
import type { PushCommand } from "./engine/index.js";

type Captured = { sql: string; args: unknown[] };

function fakeDb(reasoningJson: string) {
  const captured: Captured[] = [];
  const db = {
    prepare(sql: string) {
      return {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          return this;
        },
        async first() {
          // only updateRunCopy's SELECT of the run trace hits .first()
          return { reasoning_json: reasoningJson } as unknown;
        },
      };
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      for (const s of stmts) captured.push({ sql: s.sql, args: s.args });
      return stmts.map(() => ({ success: true }));
    },
  };
  return { db: db as unknown as D1Database, captured };
}

const baseTrace = {
  audit: { foo: 1 },
  ranks: [{ keyword: "calm", rank: 3 }],
  proposedCopy: {
    name: "Calm",
    subtitle: "Old subtitle",
    keywords: "old,terms",
    promo: "old promo",
    validation: { pass: true, checks: [] },
  },
  pushCommands: [{ store: "appstore", tool: "asc", description: "x", command: "asc OLD" }],
  trigger: { source: "manual", reasons: [] },
};

describe("updateRunCopy — persist edited copy onto the trace + proposals", () => {
  it("rewrites only proposedCopy + pushCommands and preserves the rest of the trace", async () => {
    const { db, captured } = fakeDb(JSON.stringify(baseTrace));

    const finalCopy = {
      name: "Calmer",
      subtitle: "Sleep better tonight",
      keywords: "breathe,relax,unwind",
      promo: "old promo",
    };
    const pushCommands: PushCommand[] = [
      { store: "appstore", tool: "asc", description: "y", command: "asc NEW" },
    ];

    await updateRunCopy(db, { runId: "run-1", copy: finalCopy, pushCommands });

    const upd = captured.find((c) => /UPDATE runs SET reasoning_json/.test(c.sql));
    expect(upd).toBeTruthy();
    const written = JSON.parse(upd!.args[0] as string);

    // unrelated trace fields survive verbatim
    expect(written.audit).toEqual(baseTrace.audit);
    expect(written.ranks).toEqual(baseTrace.ranks);
    expect(written.trigger).toEqual(baseTrace.trigger);

    // proposedCopy fields swapped to the edited values
    expect(written.proposedCopy.name).toBe("Calmer");
    expect(written.proposedCopy.subtitle).toBe("Sleep better tonight");
    expect(written.proposedCopy.keywords).toBe("breathe,relax,unwind");

    // pushCommands swapped to the re-derived set
    expect(written.pushCommands).toEqual(pushCommands);

    // runId bound to the UPDATE
    expect(upd!.args[1]).toBe("run-1");
  });

  it("replaces the proposals rows (DELETE then INSERT) with final values + char counts", async () => {
    const { db, captured } = fakeDb(JSON.stringify(baseTrace));

    const finalCopy = {
      name: "Calmer",
      subtitle: "Sleep better tonight",
      keywords: "breathe,relax,unwind",
      promo: "old promo",
    };

    await updateRunCopy(db, {
      runId: "run-1",
      copy: finalCopy,
      pushCommands: [],
    });

    const del = captured.find((c) => /DELETE FROM proposals/.test(c.sql));
    expect(del).toBeTruthy();
    expect(del!.args[0]).toBe("run-1");

    const inserts = captured.filter((c) => /INSERT INTO proposals/.test(c.sql));
    const byField: Record<string, { value: string; count: number }> = {};
    for (const ins of inserts) {
      // INSERT cols: id, run_id, field, value, char_count
      const field = ins.args[2] as string;
      byField[field] = { value: ins.args[3] as string, count: ins.args[4] as number };
    }
    expect(byField.name).toEqual({ value: "Calmer", count: 6 });
    expect(byField.subtitle).toEqual({ value: "Sleep better tonight", count: 20 });
    expect(byField.keywords).toEqual({ value: "breathe,relax,unwind", count: 20 });
    expect(byField.promo).toEqual({ value: "old promo", count: 9 });
  });

  it("runs the rewrite as a single atomic batch (DELETE + INSERTs + UPDATE together)", async () => {
    const { db, captured } = fakeDb(JSON.stringify(baseTrace));
    await updateRunCopy(db, {
      runId: "run-1",
      copy: { name: "A", subtitle: "B", keywords: "c", promo: "d" },
      pushCommands: [],
    });
    // one batch holds the UPDATE, the DELETE, and the per-field INSERTs.
    expect(captured.some((c) => /UPDATE runs SET reasoning_json/.test(c.sql))).toBe(true);
    expect(captured.some((c) => /DELETE FROM proposals/.test(c.sql))).toBe(true);
    expect(captured.filter((c) => /INSERT INTO proposals/.test(c.sql)).length).toBe(4);
  });
});
