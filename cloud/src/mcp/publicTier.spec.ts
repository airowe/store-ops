import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcp } from "./server.js";
import { KEY_REQUIRED_MESSAGE, PUBLIC_TOOL_NAMES, TOOLS, type ToolContext } from "./tools.js";
import type { Env } from "../index.js";

/**
 * The public tier (loop 2026-09-05, criteria 1–5).
 *
 * A stranger who runs `claude mcp add shipaso --transport http
 * https://api.shipaso.com/mcp` with no key must get a working server: the
 * tools that are already public over HTTP (`POST /preview`, `GET /proof`) run
 * anonymously; every other tool answers with a tool error that says where to
 * mint a free key. The gate lives in the registry, not the transport, so it
 * holds for any caller of a handler.
 */

const listing = { bundleId: "com.acme.app", trackName: "Acme — Habit Tracker", description: "Build better habits." };

function stubGlobalFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    if (String(url).includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [listing] }), { status: 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const env = { DEFAULT_COUNTRY: "US" } as unknown as Env;
const anon: ToolContext = { env, user: null };
const keyed: ToolContext = { env, user: { id: "u1", email: "dev@example.com" } };

async function rpc(ctx: ToolContext, body: unknown): Promise<{ status: number; json: any }> {
  const req = new Request("https://api.shipaso.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const res = await handleMcp(req, ctx);
  const text = await res.text();
  const jsonText = text.startsWith("data:") ? text.replace(/^data:\s*/, "").trim() : text;
  return { status: res.status, json: jsonText ? JSON.parse(jsonText) : null };
}

const call = (ctx: ToolContext, name: string, args: Record<string, unknown> = {}) =>
  rpc(ctx, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });

describe("the public tier is exactly what is already public over HTTP", () => {
  it("names preview_app and proof, and nothing else", () => {
    expect([...PUBLIC_TOOL_NAMES].sort()).toEqual(["preview_app", "proof"]);
    const marked = TOOLS.filter((t) => t.access === "public").map((t) => t.name).sort();
    expect(marked).toEqual(["preview_app", "proof"]);
  });

  it("tells the stranger where the free key comes from and how to re-add the server", () => {
    expect(KEY_REQUIRED_MESSAGE).toMatch(/app\.shipaso\.com/);
    expect(KEY_REQUIRED_MESSAGE).toMatch(/Agent access/);
    expect(KEY_REQUIRED_MESSAGE).toMatch(/Authorization: Bearer/);
  });
});

describe("every keyed tool refuses an anonymous caller before doing any work", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects with the key-required message and never touches the network", async () => {
    const fetchSpy = stubGlobalFetch();
    const keyedTools = TOOLS.filter((t) => t.access !== "public");
    expect(keyedTools.length).toBeGreaterThan(0);
    for (const t of keyedTools) {
      await expect(t.handler({ bundleId: "com.acme.app" }, anon), `tool "${t.name}" ran anonymously`).rejects.toThrow(
        KEY_REQUIRED_MESSAGE,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("negative control: a public tool does NOT reject with the key-required message", async () => {
    stubGlobalFetch();
    const preview = TOOLS.find((t) => t.name === "preview_app")!;
    await expect(preview.handler({ bundleId: "com.acme.app" }, anon)).resolves.toBeDefined();
  });
});

describe("anonymous MCP over the transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("initialize and tools/list work with no user at all", async () => {
    const init = await rpc(anon, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("shipaso");

    const list = await rpc(anon, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = list.json.result.tools.map((t: { name: string }) => t.name);
    // Every tool is LISTED so an agent can see what a key unlocks.
    expect(names).toContain("preview_app");
    expect(names).toContain("audit_app");
  });

  it("a keyed tool called anonymously is a tool error, not a dropped connection", async () => {
    const { status, json } = await call(anon, "audit_app", { bundleId: "com.acme.app" });
    expect(status).toBe(200);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain("Agent access");
  });

  it("preview_app runs anonymously and returns the teaser", async () => {
    stubGlobalFetch();
    const { json } = await call(anon, "preview_app", { bundleId: "com.acme.app" });
    expect(json.result.isError).not.toBe(true);
    const preview = JSON.parse(json.result.content[0].text);
    // The teaser shape (engine/preview.ts): a grade, a lead rank, a sample — and
    // never the payoff (no proposed copy, no push commands).
    expect(preview).toHaveProperty("auditGrade");
    expect(preview).toHaveProperty("keywordsChecked");
    expect(preview).not.toHaveProperty("draft");
    expect(preview).not.toHaveProperty("proposedCopy");
  });

  it("the same keyed call with a user still works (the tier is additive)", async () => {
    stubGlobalFetch();
    const { json } = await call(keyed, "audit_app", { bundleId: "com.acme.app" });
    expect(json.result.isError).not.toBe(true);
  });
});

describe("anonymous preview_app is cost-bounded like GET /report", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeCache() {
    const store = new Map<string, Response>();
    return {
      match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
      put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); }),
    };
  }

  it("serves a repeat preview from the cache without re-running the engine", async () => {
    const fetchSpy = stubGlobalFetch();
    const ctx: ToolContext = { env, user: null, guard: { cache: fakeCache() } };
    await call(ctx, "preview_app", { bundleId: "com.acme.app" });
    const after1 = fetchSpy.mock.calls.length;
    await call(ctx, "preview_app", { bundleId: "com.acme.app" });
    expect(fetchSpy.mock.calls.length).toBe(after1);
  });

  it("answers with a retry tool error when the damper says no", async () => {
    stubGlobalFetch();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const ctx: ToolContext = { env, user: null, guard: { limiter } };
    const { json } = await call(ctx, "preview_app", { bundleId: "com.acme.app" });
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/try again/i);
    expect(limiter.limit).toHaveBeenCalledWith({ key: expect.stringContaining("com.acme.app") });
  });

  it("fails open when the damper is absent or throws — a broken damper is not an outage", async () => {
    stubGlobalFetch();
    const limiter = { limit: vi.fn(async () => { throw new Error("binding down"); }) };
    const { json } = await call({ env, user: null, guard: { limiter } }, "preview_app", { bundleId: "com.acme.app" });
    expect(json.result.isError).not.toBe(true);
  });

  it("a keyed caller is never dampened or cached — it is their own quota", async () => {
    stubGlobalFetch();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const { json } = await call({ ...keyed, guard: { limiter } }, "preview_app", { bundleId: "com.acme.app" });
    expect(json.result.isError).not.toBe(true);
    expect(limiter.limit).not.toHaveBeenCalled();
  });
});
