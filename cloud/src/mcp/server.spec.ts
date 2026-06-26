import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcp } from "./server.js";
import type { ToolContext } from "./tools.js";
import type { Env } from "../index.js";

// Stub the live store so resolve/run is hermetic (see tools.spec.ts).
function stubGlobalFetch() {
  const listing = { bundleId: "com.acme.app", trackName: "Acme — Habit Tracker", description: "Build better habits." };
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [listing] }), { status: 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });
}

const ctx: ToolContext = {
  env: { DEFAULT_COUNTRY: "US" } as unknown as Env,
  user: { id: "u1", email: "dev@example.com" },
};

/** POST a single JSON-RPC message through the MCP transport and parse the reply. */
async function rpc(body: unknown): Promise<{ status: number; json: any }> {
  const req = new Request("https://api.shipaso.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Streamable HTTP requires the client to accept both content types.
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const res = await handleMcp(req, ctx);
  const text = await res.text();
  // enableJsonResponse → a plain JSON body; tolerate an SSE-framed body just in case.
  const jsonText = text.startsWith("data:") ? text.replace(/^data:\s*/, "").trim() : text;
  return { status: res.status, json: jsonText ? JSON.parse(jsonText) : null };
}

describe("MCP server over Streamable HTTP (Web standard transport)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("responds to initialize with the ShipASO server info + tools capability", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(json.result.serverInfo.name).toBe("shipaso");
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it("lists the registered read-only tools via tools/list", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("audit_app");
    expect(names).toContain("proof");
    expect(names).toContain("propose_copy");
  });

  it("invokes a tool via tools/call and returns JSON content", async () => {
    stubGlobalFetch();
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "preview_app", arguments: { bundleId: "com.acme.app" } },
    });
    expect(json.result.isError).not.toBe(true);
    const text = json.result.content[0].text as string;
    expect(text).toContain("appName");
    expect(text).toContain("Acme");
  });

  it("returns a JSON-RPC error for an unknown method", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 4, method: "no/such/method", params: {} });
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32601); // method not found
  });
});
