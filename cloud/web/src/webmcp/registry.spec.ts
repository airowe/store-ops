/**
 * The registry is the only code that touches `navigator.modelContext`. Its
 * contract: register exactly the current route's tools, drop the previous
 * route's, never throw in a browser that has no WebMCP at all, and report every
 * call so the panel can show the agent working.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "./registry.js";
import type { ModelContext, ToolDescriptor } from "./types.js";

function fakeContext() {
  const registered = new Map<string, ToolDescriptor>();
  const ctx: ModelContext & { registered: Map<string, ToolDescriptor> } = {
    registered,
    registerTool: (tool) => {
      registered.set(tool.name, tool);
      return { unregister: () => registered.delete(tool.name) };
    },
    unregisterTool: (name: string) => {
      registered.delete(name);
    },
  };
  return ctx;
}

const spec = (name: string, writes = false) => ({
  name,
  description: `does ${name}`,
  writes,
  readOnly: !writes,
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

  it("falls back to unregisterTool when registerTool returns no handle", () => {
    const bare: ModelContext = {
      registerTool: vi.fn(() => undefined),
      unregisterTool: vi.fn(),
    };
    const reg = createRegistry({ context: bare, handlers: { a: async () => "ok" } });
    reg.sync([spec("a")]);
    reg.sync([]);
    expect(bare.unregisterTool).toHaveBeenCalledWith("a");
  });
});
