/**
 * Route → registry. The React lifecycle around the WebMCP surface.
 *
 * Tools are scoped per route rather than declared once for the whole app,
 * because "what can you do here" is a genuinely different answer on the landing
 * page than at a run. An agent offered the whole API on every screen has to
 * guess which tool is relevant; an agent offered four has to guess nothing.
 *
 * The activity log exists for the PANEL, not for the agent: it is how a person
 * watching the page sees their agent working, which is the difference between
 * an assistant and something rummaging around invisibly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@shipaso/api";
import { patternFor, toolsForRoute, type ToolSpec } from "./manifest.js";
import { createHandlers } from "./handlers.js";
import { createRegistry, type ActivityEvent } from "./registry.js";
import { getModelContext, type ModelContext } from "./types.js";

/** How many recent calls the panel keeps. Bounded so a busy agent can't grow it forever. */
const ACTIVITY_LIMIT = 20;

export type ActivityEntry = ActivityEvent & { at: number; seq: number };

export type WebMcpState = {
  /** Does this browser actually implement WebMCP? */
  supported: boolean;
  /** The tools registered right now, for this route. */
  tools: readonly ToolSpec[];
  /** Most-recent-first log of tool calls, for the panel. */
  activity: readonly ActivityEntry[];
  /** Reads live tools through modelContext. Null when WebMCP is absent. */
  getTools: (() => Promise<readonly { name: string; description?: string }[]>) | null;
  /** Runs one tool through modelContext. Null when WebMCP is absent. */
  executeTool: ((tool: { name: string }, args: string) => Promise<unknown>) | null;
  /** This route's manifest PATTERN, so the tour can match its tools. */
  route: string | null;
};

/** Extract the run/app id from the current path, so tools need no arguments. */
function scopeFrom(pathname: string): { runId: string | null; appId: string | null } {
  const run = /^\/runs\/([^/]+)$/.exec(pathname);
  const app = /^\/apps\/([^/]+)/.exec(pathname);
  return { runId: run?.[1] ?? null, appId: app?.[1] ?? null };
}

export function useWebMcp(opts: {
  pathname: string;
  client: ApiClient;
  /** Injected in tests; defaults to the real navigator.modelContext. */
  context?: ModelContext | null;
}): WebMcpState {
  const { pathname, client } = opts;
  const [activity, setActivity] = useState<readonly ActivityEntry[]>([]);
  const [tools, setTools] = useState<readonly ToolSpec[]>([]);
  const seq = useRef(0);

  // The context is resolved ONCE. Re-reading navigator per render would make the
  // registry identity churn and re-register every tool on every route change.
  const context = useMemo(
    () => (opts.context === undefined ? getModelContext() : opts.context),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Route scope is read through a ref so a handler closes over the CURRENT route
  // rather than the one it was registered on — otherwise `get_run` on a second
  // run would still be answering about the first.
  const scope = useRef(scopeFrom(pathname));
  scope.current = scopeFrom(pathname);

  const onActivity = useCallback((event: ActivityEvent) => {
    setActivity((prev) => {
      seq.current += 1;
      // Date.now() is the honest timestamp here — this is display-only state in
      // a browser, not a recorded fact anyone reasons about later.
      const entry: ActivityEntry = { ...event, at: Date.now(), seq: seq.current };
      return [entry, ...prev].slice(0, ACTIVITY_LIMIT);
    });
  }, []);

  const registry = useMemo(
    () =>
      createRegistry({
        context,
        handlers: createHandlers({
          client,
          runId: () => scope.current.runId,
          appId: () => scope.current.appId,
        }),
        onActivity,
      }),
    [context, client, onActivity],
  );

  useEffect(() => {
    registry.sync(toolsForRoute(pathname));
    setTools(registry.liveTools());
  }, [registry, pathname]);

  // Teardown is its own effect keyed only on the registry: folding it into the
  // effect above would unregister and re-register every global tool on every
  // navigation, which an agent sees as the page's capabilities flickering.
  useEffect(() => () => registry.teardown(), [registry]);

  // Handed to the in-page chat so it drives tools through `modelContext` — the
  // same path an external agent uses — rather than reaching into the handlers.
  // What the drawer shows is then the real surface, not a demo-only shadow.
  const getTools = useCallback(
    async () => (context?.getTools ? await context.getTools() : []),
    [context],
  );
  const executeTool = useCallback(
    async (tool: { name: string }, args: string) => {
      const ctx = context as unknown as {
        executeTool?: (t: unknown, a: string) => Promise<unknown>;
      } | null;
      if (!ctx?.executeTool) throw new Error("this browser cannot execute WebMCP tools");
      return ctx.executeTool(tool, args);
    },
    [context],
  );

  return {
    supported: registry.supported,
    tools,
    activity,
    getTools: context ? getTools : null,
    executeTool: context ? executeTool : null,
    route: patternFor(pathname),
  };
}
