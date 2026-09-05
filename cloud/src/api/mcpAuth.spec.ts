import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import { hashApiKey } from "../apiKeys.js";
import type { Env } from "../index.js";

/**
 * POST /mcp is the front door (loop 2026-09-05, criteria 1 and 4), driven
 * through the real router:
 *
 *   - no credential at all → anonymous, the transport answers (200);
 *   - a presented-but-invalid `shipaso_` key → 401, never a silent downgrade
 *     to the public tier;
 *   - a valid key → the keyed tools run.
 */

const VALID_KEY = "shipaso_" + "ab".repeat(24);

/** Minimal D1: only the api_keys→users join the bearer path reads. Everything else is empty. */
function fakeDb(validHash: string) {
  function exec(sql: string, args: unknown[]): { row: unknown | null } {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/FROM api_keys k JOIN users u/.test(s)) {
      return { row: args[0] === validHash ? { key_id: "k1", user_id: "u1", email: "dev@example.com" } : null };
    }
    return { row: null };
  }
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { return exec(sql, bound).row as T | null; },
      async run() { return { success: true, meta: { changes: 0 } }; },
      async all<T>() { return { results: [] as T[] }; },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

async function makeEnv(): Promise<Env> {
  return {
    DB: fakeDb(await hashApiKey(VALID_KEY)),
    DEFAULT_COUNTRY: "US",
    APP_ENV: "production",
    SESSION_SECRET: "s".repeat(32),
  } as unknown as Env;
}

function mcpReq(body: unknown, authorization?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (authorization) headers["Authorization"] = authorization;
  return new Request("https://api.test/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};
const CALL_AUDIT = {
  jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: "audit_app", arguments: { bundleId: "com.acme.app" } },
};

function stubGlobalFetch() {
  const listing = { bundleId: "com.acme.app", trackName: "Acme", description: "d" };
  vi.stubGlobal("fetch", async (url: string) =>
    new Response(
      JSON.stringify(String(url).includes("/lookup") ? { resultCount: 1, results: [listing] } : { resultCount: 0, results: [] }),
      { status: 200 },
    ),
  );
}

describe("POST /mcp auth (the front door)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("no credential → anonymous, the transport answers", async () => {
    const res = await handleApi(mcpReq(INIT), await makeEnv());
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result.serverInfo.name).toBe("shipaso");
  });

  it("a presented-but-invalid key is a 401, not a silent downgrade", async () => {
    const res = await handleApi(mcpReq(INIT, "Bearer shipaso_" + "00".repeat(24)), await makeEnv());
    expect(res.status).toBe(401);
  });

  it("a garbage bearer that is not even key-shaped is also a 401", async () => {
    const res = await handleApi(mcpReq(INIT, "Bearer not-a-key"), await makeEnv());
    expect(res.status).toBe(401);
  });

  it("a valid key reaches the keyed tools", async () => {
    stubGlobalFetch();
    const res = await handleApi(mcpReq(CALL_AUDIT, `Bearer ${VALID_KEY}`), await makeEnv());
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result.isError).not.toBe(true);
  });

  it("negative control: the same keyed call with no credential is a tool error, not a 401", async () => {
    const res = await handleApi(mcpReq(CALL_AUDIT), await makeEnv());
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.result.isError).toBe(true);
  });
});
