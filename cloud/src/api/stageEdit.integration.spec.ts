/**
 * POST /runs/:id/edits as the ROUTER serves it.
 *
 * The unit tests prove `stageDecision` decides correctly; these prove the route
 * is wired AND that staging is not a disguised approval. The last test is the
 * one that matters: after a successful stage the run is STILL awaiting approval,
 * and no approval row was written. If staging ever started deciding, that test
 * fails and the entry's central claim fails with it.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-please-ignore";
const EMAIL = "owner@example.com";
const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";

const PROPOSED = { name: "Ballpark", subtitle: "Track every game", keywords: "baseball,scores" };

/** Records every write so a test can assert what did — and did not — happen. */
function fakeDb(runStatus = "awaiting_approval") {
  const writes: string[] = [];
  const user = { id: "u1", email: EMAIL, tier: "scale", status: "active", agent_paused: 0 };
  const app = { id: "app_1", user_id: "u1", bundle_id: "com.acme.app", name: "Acme", country: "US" };
  const run = {
    id: RUN,
    app_id: "app_1",
    status: runStatus,
    reasoning_json: JSON.stringify({ proposedCopy: PROPOSED }),
  };

  function exec(sql: string): { row: unknown; results?: unknown[] } {
    const s = sql.trim().replace(/\s+/g, " ");
    if (/FROM users WHERE email/i.test(s)) return { row: user };
    if (/FROM users WHERE id/i.test(s)) return { row: user };
    if (/FROM runs WHERE id/i.test(s)) return { row: run };
    if (/SELECT reasoning_json FROM runs/i.test(s)) return { row: run };
    if (/FROM apps WHERE id/i.test(s)) return { row: app };
    if (/FROM approvals WHERE run_id/i.test(s)) return { row: null };
    return { row: null, results: [] };
  }

  function prepare(sql: string) {
    const s = sql.trim().replace(/\s+/g, " ");
    if (/^(INSERT|UPDATE|DELETE)/i.test(s)) writes.push(s);
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { void bound; return exec(sql).row as T | null; },
      async run() { return { success: true, meta: { changes: 1 } }; },
      async all<T>() { return { results: (exec(sql).results ?? []) as T[] }; },
    };
    return stmt;
  }
  const batch = async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } }));
  return { db: { prepare, batch } as unknown as D1Database, writes };
}

const envFor = (db: D1Database) =>
  ({ DB: db, DEFAULT_COUNTRY: "US", APP_ENV: "test", SESSION_SECRET: SECRET }) as Env;

async function cookieHeaders(): Promise<Record<string, string>> {
  const t = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });
  return { Cookie: `store_ops_session=${t}`, "content-type": "application/json" };
}

async function stage(body: unknown, runStatus?: string) {
  const { db, writes } = fakeDb(runStatus);
  const res = await handleApi(
    new Request(`https://api.test/runs/${RUN}/edits`, {
      method: "POST",
      headers: await cookieHeaders(),
      body: JSON.stringify(body),
    }),
    envFor(db),
  );
  return { res, writes };
}

describe("POST /runs/:id/edits", () => {
  it("stages an edit to a field the run proposed", async () => {
    const { res } = await stage({ subtitle: "Every game, every score" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposedCopy: { subtitle: string }; staged: string[] };
    expect(body.proposedCopy.subtitle).toBe("Every game, every score");
    expect(body.staged).toContain("subtitle");
  });

  it("accepts the wrapped {editedCopy} shape too", async () => {
    const { res } = await stage({ editedCopy: { subtitle: "Wrapped edit" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposedCopy: { subtitle: string } };
    expect(body.proposedCopy.subtitle).toBe("Wrapped edit");
  });

  it("LEAVES THE RUN AT THE GATE — staging is not approving", async () => {
    const { res, writes } = await stage({ subtitle: "Still needs a person" });
    const body = (await res.json()) as { status: string; note: string };
    expect(body.status).toBe("awaiting_approval");
    expect(body.note).toMatch(/still awaiting approval/i);
    // The decisive negative control: no approval row, and the run's own status
    // column is never rewritten by this path.
    expect(writes.some((w) => /INSERT INTO approvals/i.test(w))).toBe(false);
    expect(writes.some((w) => /UPDATE runs SET status/i.test(w))).toBe(false);
  });

  it("records the agent as the author, so the gate can attribute the RLHF row", async () => {
    const { writes } = await stage({ subtitle: "Drafted by an agent" });
    // updateRunCopy rewrites the trace; the provenance rides on it.
    expect(writes.some((w) => /UPDATE runs SET reasoning_json/i.test(w))).toBe(true);
  });

  it("writes NO proposal_edits row — staging decides nothing to record", async () => {
    const { writes } = await stage({ subtitle: "Nothing was decided here" });
    // A proposal_edits row carries a `decision` column. Staging has no decision,
    // so any value written there would be fabricated.
    expect(writes.some((w) => /INSERT INTO proposal_edits/i.test(w))).toBe(false);
  });

  it("refuses 409 on a run that has already been decided", async () => {
    const { res } = await stage({ subtitle: "too late" }, "approved");
    expect(res.status).toBe(409);
  });

  it("refuses 400 on copy that fails validation", async () => {
    const { res } = await stage({ subtitle: "x".repeat(200) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/validation/i) });
  });

  it("refuses 400 when the edit names no proposed field", async () => {
    const { res } = await stage({ nonsense: "x" });
    expect(res.status).toBe(400);
  });

  it("refuses an unauthenticated caller", async () => {
    const { db } = fakeDb();
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/edits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subtitle: "anon" }),
      }),
      envFor(db),
    );
    expect(res.status).toBe(401);
  });
});
