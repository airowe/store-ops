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
    return { row: null, results: [] };
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { void bound; return exec(sql).row as T | null; },
      async run() { return { success: true, meta: { changes: 1 } }; },
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
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/human gesture/i) });
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

  it("ALLOWS a cookie session — the dashboard is unchanged", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/approve-all", {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(200);
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
    expect(String(body.error)).toMatch(/human gesture/i);
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
 * THE MINT ROUTE — the hole this suite could not see.
 *
 * Every test above mints a nonce by calling `mintApprovalNonce` directly, so
 * none of them ever asked the question that matters: can a caller who never
 * produced a gesture GET one from the server?
 *
 * Measured in real Chrome 151 against production: yes. A plain scripted
 * `fetch` with the user's own cookie received a valid nonce, 200. Since the
 * spend path can only check signature, kind, subject and email — all of which
 * a server-minted nonce satisfies by construction — the gate was decorative.
 *
 * `isTrusted` is a browser fact that never crosses the network, so the server
 * cannot verify a gesture happened. What it CAN verify is that the caller is
 * the page we shipped, driven by a top-level navigation: `Sec-Fetch-Site` and
 * `Sec-Fetch-Mode` are FORBIDDEN headers — page script cannot set or forge
 * them, only the browser sets them. That does not prove a human clicked; it
 * proves the request came from our own document. Combined with the trusted
 * click that the dashboard still requires client-side, it restores the
 * property that the comment claimed all along.
 */
describe("POST /runs/:id/approval-nonce — minting is itself gated", () => {
  it("MINTS for a same-origin request from our own page", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approval-nonce`, {
        method: "POST",
        headers: {
          ...(await cookieHeaders()),
          Origin: "https://app.shipaso.com",
          "Sec-Fetch-Site": "same-site",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
      }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nonce: expect.any(String) });
  });

  it("REFUSES a cross-site request — the drive-by case", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approval-nonce`, {
        method: "POST",
        headers: {
          ...(await cookieHeaders()),
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
          "Sec-Fetch-Mode": "cors",
        },
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });

  it("REFUSES a bearer/agent credential — a nonce needs the browser, not a key", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approval-nonce`, {
        method: "POST",
        headers: await bearerHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });

  it("REFUSES a request with NO Sec-Fetch-Site — a non-browser client", async () => {
    const res = await handleApi(
      new Request(`https://api.test/runs/${RUN}/approval-nonce`, {
        method: "POST",
        headers: await cookieHeaders(),
      }),
      env(),
    );
    expect(res.status).toBe(403);
  });
});
