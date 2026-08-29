/**
 * ADR-001 end-to-end: the approval boundary as the ROUTER enforces it.
 *
 * The unit tests in approvalBoundary.spec.ts prove the policy functions decide
 * correctly. These prove the policy is actually WIRED — that a real Request for
 * a real path is refused. Without this, a correct policy that nobody calls would
 * pass every test we have (the mocked dashboard tests included) while the gate
 * stood open in production.
 *
 * The negative control is the point: each case feeds a known-bad request and
 * asserts the refusal, so the suite can return "no".
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import { mintApprovalNonce, mintSessionToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-please-ignore";
const EMAIL = "owner@example.com";
const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";

/** Minimal D1 stand-in: enough rows for ownership + the run to resolve. */
function fakeDb(): D1Database {
  const user = { id: "u1", email: EMAIL, tier: "scale", status: "active", agent_paused: 0 };
  const app = { id: "app_1", user_id: "u1", bundle_id: "com.acme.app", name: "Acme", country: "US" };
  const run = { id: RUN, app_id: "app_1", status: "awaiting_approval", reasoning_json: "{}" };
  const settledRun = {
    id: "11111111-2222-4333-8444-555555555555",
    app_id: "app_1",
    app_name: "Acme",
    status: "approved",
    created_at: "2026-01-01 00:00:00",
    reasoning_json: "{}",
  };

  function exec(sql: string): { row: unknown; results?: unknown[] } {
    const s = sql.trim().replace(/\s+/g, " ");
    if (/FROM users WHERE email/i.test(s)) return { row: user };
    if (/FROM users WHERE id/i.test(s)) return { row: user };
    if (/INSERT INTO users/i.test(s)) return { row: null };
    if (/FROM runs WHERE id/i.test(s)) return { row: run };
    if (/FROM apps WHERE id/i.test(s)) return { row: app };
    if (/FROM apps WHERE user_id/i.test(s)) return { row: app, results: [app] };
    if (/FROM approvals WHERE run_id/i.test(s)) return { row: null };
    if (/FROM runs WHERE app_id/i.test(s)) return { row: run, results: [run] };
    // listRunsForUser: the portfolio queue. Returns one run AT the gate and one
    // already settled, so the challenge-issuance tests can tell them apart —
    // an empty list would make those assertions pass vacuously.
    if (/FROM runs r JOIN apps a/i.test(s)) {
      return { row: run, results: [run, settledRun] };
    }
    return { row: null, results: [] };
  }

  // Challenges this DB has issued and not yet spent. Without this the fake
  // accepts any UPDATE, so an invented challenge "spends" and the suite cannot
  // fail on the attack it exists to describe.
  const issued = new Set<string>();

  function prepare(sql: string) {
    const q = sql.trim().replace(/\s+/g, " ");
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() {
        if (/FROM approval_challenges/i.test(q)) return null as T | null;
        return exec(sql).row as T | null;
      },
      async run() {
        if (/INSERT INTO approval_challenges/i.test(q)) {
          issued.add(String(bound[0]));
          return { success: true, meta: { changes: 1 } };
        }
        if (/UPDATE approval_challenges/i.test(q)) {
          // bind order: (now, challenge, run, user, now)
          const value = String(bound[1]);
          const ok = issued.delete(value); // single-use: gone once spent
          return { success: true, meta: { changes: ok ? 1 : 0 } };
        }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() { return { results: (exec(sql).results ?? []) as T[] }; },
    };
    return stmt;
  }
  // recordApproval writes through db.batch — the stub accepts and reports success.
  const batch = async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } }));
  return { prepare, batch } as unknown as D1Database;
}

const env = () =>
  ({ DB: fakeDb(), DEFAULT_COUNTRY: "US", APP_ENV: "test", SESSION_SECRET: SECRET }) as Env;

async function cookieHeaders(): Promise<Record<string, string>> {
  const t = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });
  return { Cookie: `store_ops_session=${t}` };
}
async function bearerHeaders(): Promise<Record<string, string>> {
  const t = await mintSessionToken(SECRET, EMAIL, { ttlSeconds: 3600 });
  return { Authorization: `Bearer ${t}` };
}

describe("POST /runs/:id/approve — the nonce gate is WIRED", () => {
  it("REFUSES 403 when an authenticated caller sends no nonce", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ boundary: "human-approval-required" });
  });

  it("REFUSES 403 for a bearer/agent credential with no nonce", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: await bearerHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });

  it("REFUSES 403 when the nonce is for a DIFFERENT run", async () => {
    const other = await mintApprovalNonce(SECRET, EMAIL, "00000000-1111-4222-8333-444444444444");
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: { ...(await cookieHeaders()), "x-approval-nonce": other },
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });

  it("does NOT refuse REJECT — clearing a bad proposal stays open to agents", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/reject`, {
        method: "POST",
        headers: await bearerHeaders(),
      }),
      env(),
    );
    expect(res.status).not.toBe(403);
  });
});

describe("POST /runs/approve-all — cookie-only is WIRED", () => {
  it("REFUSES 403 for a bearer/agent credential", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: await bearerHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/browser session/i) });
  });

  /**
   * THE TEST THAT LET #515 SHIP, corrected.
   *
   * It used to assert this exact request returns 200 — "the dashboard is
   * unchanged" — which made the bypass look like intended behaviour. A cookie
   * session carrying no challenges is precisely what a browser-resident agent
   * sends, and in production that request approved 12 runs with no human
   * gesture. The cookie check refuses API keys; it never refused the caller
   * that actually got through.
   */
  it("REFUSES a cookie session that presents NO challenges (#515)", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ boundary: "human-approval-required" });
  });

  it("REFUSES a cookie session presenting a challenge that does not spend", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: { ...(await cookieHeaders()), "content-type": "application/json" },
        body: JSON.stringify({ challenges: [{ runId: RUN, challenge: "not-a-real-challenge" }] }),
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });
});

describe("refusals reach the wire structured (not just prose)", () => {
  it("the 403 body carries the machine fields, not only `error`", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.boundary).toBe("human-approval-required");
    expect(Array.isArray(body.youCan)).toBe(true);
    expect(body.humanMustDo).toBeTruthy();
    // prose survives for a human reading logs
    expect(String(body.error)).toMatch(/challenge|approv/i);
  });

  it("approve-all's 403 is structured too", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: await bearerHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.boundary).toBe("human-approval-required");
  });

  it("advertises the WebMCP surface on responses", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.headers.get("link")).toMatch(/rel="webmcp"/);
  });
});

/**
 * THE ATTACK, reproduced as the router sees it.
 *
 * The previous two attempts both passed their own tests and both left the hole
 * open. The first minted a stateless nonce from a dedicated endpoint; the
 * second gated that endpoint on `Sec-Fetch-*`, which distinguishes our page
 * from another SITE but not a human from script running INSIDE our page — the
 * actual threat. Neither suite ever wrote down the attack, so neither could
 * fail on it.
 *
 * This does. The attacker here is exactly what was measured against
 * production: a caller with a valid cookie session who never opened the run,
 * presenting whatever it can construct on its own.
 */
describe("THE ATTACK: approving without the run view's challenge", () => {
  it("REFUSES a cookie-session caller that never opened the run", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ boundary: "human-approval-required" });
  });

  it("REFUSES a challenge the caller invented", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: { ...(await cookieHeaders()), "x-approval-challenge": "made-up" },
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });

  it("the credential-vending endpoint is GONE — not merely gated", async () => {
    // The route whose entire job was handing out approval credentials on
    // request. A 200 here would mean the hole is back regardless of what the
    // approve path does.
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approval-nonce`, {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).not.toBe(200);
  });
});

/**
 * THE HONEST PATH — the negative control for the negative controls.
 *
 * Every test above asserts a refusal. A gate that refuses everything would pass
 * all of them and ship a dashboard nobody can approve in, so this asserts the
 * dashboard's own sequence still works: open the run, take the challenge from
 * the view, spend it once.
 *
 * It also pins the property that makes the challenge worth holding state for:
 * the SECOND spend of the same value fails.
 */
describe("the dashboard's own sequence still approves", () => {
  it("open the run, spend its challenge, approve — and no replay", async () => {
    const e = env();
    const headers = await cookieHeaders();

    const view = await handleApi(
      new Request(`https://api.test/runs/${RUN}`, { headers }),
      e,
    );
    expect(view.status).toBe(200);
    const { approval_challenge } = (await view.json()) as { approval_challenge?: string };
    expect(approval_challenge).toEqual(expect.any(String));

    const ok = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: { ...headers, "x-approval-challenge": approval_challenge! },
      }),
      e,
    );
    expect(ok.status).toBe(200);

    const replay = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approve`, {
        method: "POST",
        headers: { ...headers, "x-approval-challenge": approval_challenge! },
      }),
      e,
    );
    expect(replay.status).toBe(403);
  });
});

/**
 * GET /runs issues the challenges the bulk button spends (#515).
 *
 * Gating approve-all is only half a fix: the dashboard's "Approve all N" has to
 * be able to present a challenge per queued run, or the button just 403s. They
 * ride back on the list for runs at the gate — and ONLY those, since a run that
 * is not awaiting approval has nothing to approve.
 */
describe("GET /runs — challenges ride back with the queue", () => {
  it("issues a challenge for a run awaiting approval", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs", { headers: await cookieHeaders() }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ status: string; approval_challenge?: unknown }> };
    const awaiting = body.runs.filter((r) => r.status === "awaiting_approval");
    for (const r of awaiting) expect(r.approval_challenge).toBeTruthy();
  });

  it("does NOT issue one for a run that is not at the gate", async () => {
    // A challenge on an approved or rejected run would be a credential minted
    // for an action that is already settled.
    const res = await handleApi(
      new Request("https://api.test/runs", { headers: await cookieHeaders() }),
      env(),
    );
    const body = (await res.json()) as { runs: Array<{ status: string; approval_challenge?: unknown }> };
    const settled = body.runs.filter((r) => r.status !== "awaiting_approval");
    for (const r of settled) expect(r.approval_challenge).toBeUndefined();
  });
});
