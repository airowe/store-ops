/**
 * The one place that touches `navigator.modelContext`.
 *
 * Isolated for two reasons. First, WebMCP ships in Chrome 146 behind a flag, so
 * the overwhelmingly common case is that it is ABSENT — every entry point here
 * degrades to a no-op rather than a crash, and `supported` lets the UI say so
 * plainly instead of pretending. Second, it keeps the lifecycle honest: tools
 * are registered per route and dropped on the way out, so an agent is never
 * offered a tool for a screen the user has left.
 *
 * A handler never rejects into the agent. A thrown error becomes an error
 * RESULT, because an agent that receives a rejected promise learns nothing,
 * while one that receives "the API said no: 403" can tell the user why.
 */
import { getModelContext, type ModelContext, type RegisteredTool, type ToolResult } from "./types.js";
import type { ToolSpec } from "./manifest.js";

/** What a tool actually does. Returns the text handed back to the agent. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string> | string;

export type ActivityEvent = {
  name: string;
  phase: "start" | "done" | "error";
  /** Present on "error" only. */
  message?: string;
};

export type Registry = {
  /** Is there a real WebMCP implementation behind this? */
  readonly supported: boolean;
  /** Make the live set exactly `specs` — registering and unregistering to match. */
  sync: (specs: readonly ToolSpec[]) => void;
  /** The specs currently registered. */
  liveTools: () => readonly ToolSpec[];
  /** Drop every tool. */
  teardown: () => void;
};

type Live = { spec: ToolSpec; handle: RegisteredTool | null };

export function createRegistry(opts: {
  context?: ModelContext | null;
  handlers: Record<string, ToolHandler>;
  onActivity?: (event: ActivityEvent) => void;
}): Registry {
  const context = opts.context === undefined ? getModelContext() : opts.context;
  const live = new Map<string, Live>();

  function drop(name: string) {
    const entry = live.get(name);
    if (!entry) return;
    // registerTool's return value is the spec'd way to undo one registration;
    // unregisterTool(name) is the fallback for implementations that return void.
    if (entry.handle) entry.handle.unregister();
    else context?.unregisterTool?.(name);
    live.delete(name);
  }

  function add(spec: ToolSpec) {
    const handler = opts.handlers[spec.name];
    // A declared tool with no implementation would register fine and then fail
    // on first call. Better to never advertise it: an agent can only be honest
    // about a surface that is honest with it.
    if (!handler || !context) return;
    const handle = context.registerTool({
      name: spec.name,
      description: spec.description,
      annotations: { readOnlyHint: spec.readOnly },
      execute: async (args): Promise<ToolResult> => {
        opts.onActivity?.({ name: spec.name, phase: "start" });
        try {
          const text = await handler(args ?? {});
          opts.onActivity?.({ name: spec.name, phase: "done" });
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          opts.onActivity?.({ name: spec.name, phase: "error", message });
          return { content: [{ type: "text", text: message }], isError: true };
        }
      },
    });
    live.set(spec.name, { spec, handle: handle ?? null });
  }

  return {
    supported: context !== null,
    sync(specs) {
      const wanted = new Set(specs.map((s) => s.name));
      for (const name of [...live.keys()]) if (!wanted.has(name)) drop(name);
      // Re-registering a live tool would churn the agent's view of the page for
      // no gain, so only genuinely new names are added.
      for (const spec of specs) if (!live.has(spec.name)) add(spec);
    },
    liveTools: () => [...live.values()].map((l) => l.spec),
    teardown() {
      for (const name of [...live.keys()]) drop(name);
    },
  };
}
