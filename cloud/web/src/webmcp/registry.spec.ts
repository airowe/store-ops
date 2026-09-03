/**
 * The registry is the only code that touches the browser's model context. Its
 * contract: register exactly the current route's tools, drop the previous
 * route's, never throw in a browser that has no WebMCP at all, and report every
 * call so the panel can show the agent working.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "./registry.js";
import type { ModelContext, ToolDescriptor } from "./types.js";
import type { ToolSpec } from "./manifest.js";

/**
 * Models Chrome 151 as MEASURED, not as earlier drafts described it:
 * `registerTool` returns undefined, there is no `unregisterTool`, and the only
 * way to remove a tool is to abort the signal passed at registration. A fake
 * that offers an `unregister()` handle cannot fail on the accumulation bug that
 * actually shipped, which is why the old one passed while production leaked.
 */
function fakeContext() {
  const registered = new Map<string, ToolDescriptor>();
  const ctx: ModelContext & { registered: Map<string, ToolDescriptor> } = {
    registered,
    registerTool: (tool, options) => {
      if (registered.has(tool.name)) {
        throw new DOMException("Duplicate tool name", "InvalidStateError");
      }
      registered.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => registered.delete(tool.name));
      return undefined;
    },
  };
  return ctx;
}

const spec = (name: string, writes = false, untrustedContent = false) => ({
  name,
  description: `does ${name}`,
  writes,
  readOnly: !writes,
  untrustedContent,
  routes: ["*"] as const,
  effect: name,
});

describe("createRegistry", () => {
  let ctx: ReturnType<typeof fakeContext>;
  beforeEach(() => {
    ctx = fakeContext();
  });

  it("registers the tools it is given", () => {
    const reg = createRegistry({ context: ctx, handlers: { a: async () => "ok" } });
    reg.sync([spec("a")]);
    expect([...ctx.registered.keys()]).toEqual(["a"]);
  });

  it("unregisters tools that are no longer on the route", () => {
    const reg = createRegistry({
      context: ctx,
      handlers: { a: async () => "ok", b: async () => "ok" },
    });
    reg.sync([spec("a"), spec("b")]);
    reg.sync([spec("a")]);
    expect([...ctx.registered.keys()]).toEqual(["a"]);
  });

  it("does not re-register a tool that is already live", () => {
    const reg = createRegistry({ context: ctx, handlers: { a: async () => "ok" } });
    reg.sync([spec("a")]);
    const first = ctx.registered.get("a");
    reg.sync([spec("a")]);
    expect(ctx.registered.get("a")).toBe(first);
  });

  it("advertises readOnlyHint for reading tools and not for writing ones", () => {
    const reg = createRegistry({
      context: ctx,
      handlers: { r: async () => "ok", w: async () => "ok" },
    });
    reg.sync([spec("r"), spec("w", true)]);
    expect(ctx.registered.get("r")?.annotations?.readOnlyHint).toBe(true);
    expect(ctx.registered.get("w")?.annotations?.readOnlyHint).toBe(false);
  });

  it("marks results that include external or recorded content as untrusted", () => {
    const reg = createRegistry({ context: ctx, handlers: { audit: async () => "ok" } });
    reg.sync([spec("audit", false, true)]);
    expect(ctx.registered.get("audit")?.annotations?.untrustedContentHint).toBe(true);
  });

  it("skips a tool with no handler rather than registering something that throws", () => {
    const reg = createRegistry({ context: ctx, handlers: {} });
    reg.sync([spec("orphan")]);
    expect([...ctx.registered.keys()]).toEqual([]);
  });

  it("is a no-op — never a throw — when the browser has no WebMCP", () => {
    const reg = createRegistry({ context: null, handlers: { a: async () => "ok" } });
    expect(() => reg.sync([spec("a")])).not.toThrow();
    expect(reg.liveTools()).toEqual([]);
    expect(reg.supported).toBe(false);
  });

  it("reports the live tool names", () => {
    const reg = createRegistry({
      context: ctx,
      handlers: { a: async () => "ok", b: async () => "ok" },
    });
    reg.sync([spec("a"), spec("b")]);
    expect(reg.liveTools().map((t) => t.name).sort()).toEqual(["a", "b"]);
  });

  it("runs the handler and returns its text to the agent", async () => {
    const reg = createRegistry({
      context: ctx,
      handlers: { a: async (args) => `got ${args.q}` },
    });
    reg.sync([spec("a")]);
    const result = await ctx.registered.get("a")!.execute({ q: "hi" });
    expect(result.content[0]!.text).toBe("got hi");
    expect(result.isError).toBeFalsy();
  });

  it("turns a handler failure into an error RESULT, never a rejected promise", async () => {
    const reg = createRegistry({
      context: ctx,
      handlers: {
        a: async () => {
          throw new Error("the API said no");
        },
      },
    });
    reg.sync([spec("a")]);
    const result = await ctx.registered.get("a")!.execute({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("the API said no");
  });

  it("notifies a subscriber when a tool is called, and when it settles", async () => {
    const seen: Array<{ name: string; phase: string }> = [];
    const reg = createRegistry({
      context: ctx,
      handlers: { a: async () => "ok" },
      onActivity: (e) => seen.push({ name: e.name, phase: e.phase }),
    });
    reg.sync([spec("a")]);
    await ctx.registered.get("a")!.execute({});
    expect(seen).toEqual([
      { name: "a", phase: "start" },
      { name: "a", phase: "done" },
    ]);
  });

  it("reports a failed call as an error activity, not a done", async () => {
    const seen: string[] = [];
    const reg = createRegistry({
      context: ctx,
      handlers: {
        a: async () => {
          throw new Error("nope");
        },
      },
      onActivity: (e) => seen.push(e.phase),
    });
    reg.sync([spec("a")]);
    await ctx.registered.get("a")!.execute({});
    expect(seen).toEqual(["start", "error"]);
  });

  it("drops everything on teardown", () => {
    const reg = createRegistry({ context: ctx, handlers: { a: async () => "ok" } });
    reg.sync([spec("a")]);
    reg.teardown();
    expect([...ctx.registered.keys()]).toEqual([]);
    expect(reg.liveTools()).toEqual([]);
  });

  it("does not record a tool whose registration THREW as live", () => {
    // Chrome has no unregisterTool to fall back on, so the only correctness
    // question left is bookkeeping: a refused registration must not appear in
    // liveTools(), or the panel would advertise a tool the agent cannot see.
    const refusing: ModelContext = {
      registerTool: vi.fn(() => {
        throw new DOMException("Duplicate tool name", "InvalidStateError");
      }),
    };
    const reg = createRegistry({ context: refusing, handlers: { a: async () => "ok" } });
    expect(() => reg.sync([spec("a")])).not.toThrow();
    expect(reg.liveTools()).toEqual([]);
  });

  it("removes a tool whose promise-returning registration rejects", async () => {
    const refusing: ModelContext = {
      registerTool: () => Promise.reject(new Error("registration refused")),
    };
    const reg = createRegistry({ context: refusing, handlers: { a: async () => "ok" } });

    reg.sync([spec("a")]);
    expect(reg.liveTools().map((tool) => tool.name)).toEqual(["a"]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(reg.liveTools()).toEqual([]);
  });
});

/**
 * LIFECYCLE against the REAL Chrome 151 contract.
 *
 * The earlier fake in this file modelled a `RegisteredTool.unregister()` handle
 * and an `unregisterTool(name)` fallback. Measured in Chrome 151, NEITHER
 * exists: `registerTool` returns undefined, the prototype is only
 * {registerTool, getTools, executeTool, ontoolchange}, and re-registering a
 * live name throws `InvalidStateError: Duplicate tool name`. Unregistration is
 * via AbortSignal — verified in-browser: abort removes the tool and frees the
 * name.
 *
 * So the old fake could never fail on the bug that shipped: drop() called
 * methods that were not there, tools accumulated across routes, and the throw
 * on the next visit was swallowed by the handler catch. This fake refuses to
 * implement anything Chrome does not.
 */
describe("lifecycle on the real Chrome 151 contract", () => {
  function chrome151() {
    const live = new Map<string, ToolDescriptor>();
    const context = {
      registerTool(tool: ToolDescriptor, options?: { signal?: AbortSignal }) {
        if (live.has(tool.name)) {
          throw new DOMException("Duplicate tool name", "InvalidStateError");
        }
        live.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => live.delete(tool.name));
        // Chrome returns undefined — no handle to unregister with.
        return undefined;
      },
    };
    return { context, names: () => [...live.keys()].sort() };
  }

  const spec = (name: string): ToolSpec => ({
    name, description: `${name} desc`, writes: false, readOnly: true,
    routes: ["*"], effect: `does ${name}`,
  });
  const handlers = {
    a: async () => "a", b: async () => "b", c: async () => "c",
  };

  it("REMOVES a tool that leaves the route — the accumulation bug", () => {
    const { context, names } = chrome151();
    const r = createRegistry({ context, handlers });
    r.sync([spec("a"), spec("b")]);
    expect(names()).toEqual(["a", "b"]);
    r.sync([spec("b"), spec("c")]);
    expect(names()).toEqual(["b", "c"]);
  });

  it("SURVIVES returning to a route — no InvalidStateError on re-register", () => {
    const { context, names } = chrome151();
    const r = createRegistry({ context, handlers });
    r.sync([spec("a")]);
    r.sync([spec("b")]);
    expect(() => r.sync([spec("a")])).not.toThrow();
    expect(names()).toEqual(["a"]);
  });

  it("teardown drops everything", () => {
    const { context, names } = chrome151();
    const r = createRegistry({ context, handlers });
    r.sync([spec("a"), spec("b")]);
    r.teardown();
    expect(names()).toEqual([]);
  });

  it("always sends an inputSchema — the agent reads it to build a call", () => {
    const seen: ToolDescriptor[] = [];
    const context = {
      registerTool(tool: ToolDescriptor) { seen.push(tool); return undefined; },
    };
    const r = createRegistry({ context, handlers });
    r.sync([spec("a")]);
    expect(seen[0]!.inputSchema).toMatchObject({ type: "object" });
  });
});
