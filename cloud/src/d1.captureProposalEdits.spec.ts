/**
 * RLHF capture at the d1 layer (#39 Part 2). `captureProposalEdits` turns the
 * pure preference rows into ENCRYPTED INSERT statements for the `proposal_edits`
 * table, to be appended to recordApproval's atomic batch.
 *
 * Pinned here:
 *   • SAFE-DEGRADE: with no key (null), it returns ZERO statements and writes
 *     nothing (the approval still proceeds — verified at the call site).
 *   • ANONYMITY: the generated SQL inserts NO user_id / NO app_id column — it is
 *     structurally impossible to attach an identity to a row.
 *   • ENCRYPTION: the bound proposed_enc / final_enc values are NOT the plaintext
 *     copy; round-tripping them through decryptField recovers the originals.
 *   • one INSERT per editable field the agent proposed; edited flag preserved;
 *     a 'rejected' decision still produces rows.
 */
import { describe, expect, it } from "vitest";
import { captureProposalEdits } from "./d1.js";
import { decryptField, importKeyFromBase64 } from "./crypto/rlhfCrypto.js";

function testKeyB64(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (i * 17 + 3) & 0xff;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type Captured = { sql: string; args: unknown[] };

/** Minimal fake D1 that records prepare→bind for every statement. */
function fakeDb() {
  const prepared: Captured[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          prepared.push({ sql, args });
          return this;
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, prepared };
}

const proposed = {
  name: "Heathen",
  subtitle: "Daily tarot & rituals",
  keywords: "tarot,occult,ritual",
  promo: "Read the cards.",
};

describe("captureProposalEdits", () => {
  it("returns ZERO statements when the key is absent (safe-degrade)", async () => {
    const { db, prepared } = fakeDb();
    const stmts = await captureProposalEdits(db, null, {
      proposed,
      final: proposed,
      decision: "approved",
    });
    expect(stmts).toEqual([]);
    expect(prepared).toEqual([]);
  });

  it("emits one anonymous INSERT per proposed field — NO user_id / NO app_id", async () => {
    const { db } = fakeDb();
    const key = await importKeyFromBase64(testKeyB64());
    const stmts = await captureProposalEdits(db, key, {
      proposed,
      final: proposed,
      decision: "approved",
    });
    expect(stmts.length).toBe(4);
    for (const s of stmts as unknown as Captured[]) {
      expect(s.sql).toMatch(/INSERT INTO proposal_edits/);
      expect(s.sql).not.toMatch(/user_id/);
      expect(s.sql).not.toMatch(/app_id/);
    }
  });

  it("encrypts proposed + final values (not plaintext) and they decrypt back", async () => {
    const { db } = fakeDb();
    const key = await importKeyFromBase64(testKeyB64());
    const final = { ...proposed, subtitle: "Tarot, rituals & moon phases" };
    const stmts = (await captureProposalEdits(db, key, {
      proposed,
      final,
      decision: "approved",
    })) as unknown as Captured[];

    const subtitleStmt = stmts.find(
      (s) => Array.isArray(s.args) && s.args[1] === "subtitle",
    )!;
    // columns: id, field, decision, edited, proposed_enc, final_enc, created_at
    const args = subtitleStmt.args as [string, string, string, number, string, string, string];
    const [, field, decision, edited, proposedEnc, finalEnc] = args;
    expect(field).toBe("subtitle");
    expect(decision).toBe("approved");
    expect(edited).toBe(1);
    expect(proposedEnc).not.toContain("tarot");
    expect(finalEnc).not.toContain("moon");
    expect(await decryptField(key, proposedEnc)).toBe(proposed.subtitle);
    expect(await decryptField(key, finalEnc)).toBe(final.subtitle);
  });

  it("still captures rows on a 'rejected' decision (negative signal)", async () => {
    const { db } = fakeDb();
    const key = await importKeyFromBase64(testKeyB64());
    const stmts = (await captureProposalEdits(db, key, {
      proposed,
      final: proposed,
      decision: "rejected",
    })) as unknown as Captured[];
    expect(stmts.length).toBe(4);
    expect(stmts.every((s) => s.args[2] === "rejected")).toBe(true);
    expect(stmts.every((s) => s.args[3] === 0)).toBe(true); // unedited
  });
});
