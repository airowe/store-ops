/**
 * Migration 0013 end-to-end: does an agent-drafted approval actually get
 * recorded as agent-drafted?
 *
 * The unit test proves `editSourceFor` decides correctly; this proves the value
 * reaches the `proposal_edits` row. That gap is exactly where this feature was
 * already broken once — the column shipped, and the approve path never passed
 * anything to it, so every row said 'human' regardless.
 *
 * The negative control is the second test: a run nobody staged onto must still
 * record 'human', or the attribution is just a constant.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintApprovalNonce, mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-please-ignore";
const EMAIL = "owner@example.com";
const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";
const PROPOSED = { name: "Ballpark", subtitle: "Track every game", keywords: "baseball,scores" };

/** Captures every bind() so a test can read what was written to proposal_edits. */
function fakeDb(traceExtra: Record<string, unknown> = {}) {
  const binds: Array<{ sql: string; args: unknown[] }> = [];
  const user = { id: "u1", email: EMAIL, tier: "scale", status: "active", agent_paused: 0 };
  const app = { id: "app_1", user_id: "u1", bundle_id: "com.acme.app", name: "Acme", country: "US" };
  const run = {
    id: RUN,
    app_id: "app_1",
    status: "awaiting_approval",
    reasoning_json: JSON.stringify({ proposedCopy: PROPOSED, ...traceExtra }),
  };

  function exec(sql: string): { row: unknown; results?: unknown[] } {
    const s = sql.trim().replace(/\s+/g, " ");
    if (/FROM users WHERE email/i.test(s)) return { row: user };
    if (/FROM users WHERE id/i.test(s)) return { row: user };
    if (/FROM runs WHERE id/i.test(s)) return { row: run };
    if (/SELECT reasoning_json FROM runs/i.test(s)) return { row: run };
    if (/FROM apps WHERE id/i.test(s)) return { row: app };
    if (/FROM approvals WHERE run_id/i.test(s)) return { row: null };
    // rlhf opt-out lookup: not opted out
    if (/rlhf_opt_out/i.test(s)) return { row: { rlhf_opt_out: 0 } };
    return { row: null, results: [] };
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        bound = a;
        binds.push({ sql: sql.trim().replace(/\s+/g, " "), args: a });
        return stmt;
      },
      async first<T>() { void bound; return exec(sql).row as T | null; },
      async run() { return { success: true, meta: { changes: 1 } }; },
      async all<T>() { return { results: (exec(sql).results ?? []) as T[] }; },
    };
    return stmt;
  }
  const batch = async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } }));
  return { db: { prepare, batch } as unknown as D1Database, binds };
}

/** A 32-byte base64 key so the RLHF capture path actually runs. */
const RLHF_KEY = Buffer.alloc(32, 7).toString("base64");

const envFor = (db: D1Database) =>
  ({
    DB: db,
    DEFAULT_COUNTRY: "US",
    APP_ENV: "test",
    SESSION_SECRET: SECRET,
    RLHF_ENCRYPTION_KEY: RLHF_KEY,
  }) as unknown as Env;

async function approve(traceExtra: Record<string, unknown>) {
  const { db, binds } = fakeDb(traceExtra);
  const token = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });
  const nonce = await mintApprovalNonce(SECRET, EMAIL, RUN);
  const res = await handleApi(
    new Request(`https://api.test/runs/${RUN}/approve`, {
      method: "POST",
      headers: {
        Cookie: `store_ops_session=${token}`,
        "x-approval-nonce": nonce,
        "content-type": "application/json",
      },
      body: JSON.stringify({ decision: "approve" }),
    }),
    envFor(db),
  );
  // proposal_edits binds `source` last (…, created_at, source).
  const rows = binds.filter((b) => /INSERT INTO proposal_edits/i.test(b.sql));
  return { res, sources: rows.map((r) => r.args[r.args.length - 1]) };
}

describe("proposal_edits.source is recorded, not defaulted", () => {
  it("records 'agent-draft' when an agent staged the approved copy", async () => {
    const { res, sources } = await approve({ lastEditSource: "agent-draft" });
    expect(res.status).toBe(200);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(["agent-draft"]));
  });

  it("records 'human' when nothing staged onto the run", async () => {
    const { res, sources } = await approve({});
    expect(res.status).toBe(200);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(["human"]));
  });
});
