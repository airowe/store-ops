/**
 * The hook wires route → registry. Its job is lifecycle: register this route's
 * tools, drop the last route's, and tear everything down on unmount so an agent
 * is never offered a tool for a screen nobody is on.
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebMcp } from "./useWebMcp.js";
import type { ModelContext, ToolDescriptor } from "./types.js";

/** Chrome 151 as measured: no handle, no unregisterTool, abort-driven removal. */
function fakeContext() {
  const registered = new Map<string, ToolDescriptor>();
  const ctx: ModelContext = {
    registerTool: (tool, options) => {
      if (registered.has(tool.name)) {
        throw new DOMException("Duplicate tool name", "InvalidStateError");
      }
      registered.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => registered.delete(tool.name));
    },
  };
  return { ctx, registered };
}

const client = {
  get: async () => ({}),
  post: async () => ({}),
  request: async () => ({}),
} as never;

describe("useWebMcp", () => {
  it("registers the landing tools on /", () => {
    const { ctx, registered } = fakeContext();
    renderHook(() => useWebMcp({ pathname: "/", client, context: ctx }));
    expect([...registered.keys()]).toContain("search_app");
    expect([...registered.keys()]).not.toContain("draft_alternative");
  });

  it("swaps the tool set when the route changes", () => {
    const { ctx, registered } = fakeContext();
    const { rerender } = renderHook(
      ({ pathname }) => useWebMcp({ pathname, client, context: ctx }),
      { initialProps: { pathname: "/" } },
    );
    expect([...registered.keys()]).toContain("search_app");
    rerender({ pathname: "/runs/r_1" });
    expect([...registered.keys()]).toContain("draft_alternative");
    expect([...registered.keys()]).not.toContain("search_app");
  });

  it("keeps the global tools across a route change", () => {
    const { ctx, registered } = fakeContext();
    const { rerender } = renderHook(
      ({ pathname }) => useWebMcp({ pathname, client, context: ctx }),
      { initialProps: { pathname: "/" } },
    );
    rerender({ pathname: "/runs" });
    expect([...registered.keys()]).toContain("whoami");
    expect([...registered.keys()]).toContain("describe_boundary");
  });

  it("unregisters everything on unmount", () => {
    const { ctx, registered } = fakeContext();
    const { unmount } = renderHook(() => useWebMcp({ pathname: "/runs", client, context: ctx }));
    expect(registered.size).toBeGreaterThan(0);
    unmount();
    expect(registered.size).toBe(0);
  });

  it("reports the live tools so the panel can render them", () => {
    const { ctx } = fakeContext();
    const { result } = renderHook(() => useWebMcp({ pathname: "/runs", client, context: ctx }));
    expect(result.current.tools.map((t) => t.name)).toContain("list_pending_runs");
    expect(result.current.supported).toBe(true);
  });

  it("reports unsupported — and NO tools — in a browser without WebMCP", () => {
    const { result } = renderHook(() => useWebMcp({ pathname: "/runs", client, context: null }));
    expect(result.current.supported).toBe(false);
    expect(result.current.tools).toEqual([]);
  });

  it("records a tool call as recent activity", async () => {
    const { ctx, registered } = fakeContext();
    const { result } = renderHook(() => useWebMcp({ pathname: "/", client, context: ctx }));
    expect(result.current.activity).toEqual([]);
    await act(async () => {
      await registered.get("describe_boundary")!.execute({});
    });
    expect(result.current.activity[0]).toMatchObject({ name: "describe_boundary" });
  });

  it("never lets the activity log grow without bound", async () => {
    const { ctx, registered } = fakeContext();
    const { result } = renderHook(() => useWebMcp({ pathname: "/", client, context: ctx }));
    await act(async () => {
      for (let i = 0; i < 40; i++) await registered.get("describe_boundary")!.execute({});
    });
    expect(result.current.activity.length).toBeLessThanOrEqual(20);
  });
});
