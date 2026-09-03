/**
 * WebMCP (`document.modelContext` / `navigator.modelContext`) typings.
 *
 * Hand-written on purpose: the API ships in Chrome 146 behind a flag and has no
 * published @types package, so there is nothing to depend on. Kept to the subset
 * of the W3C draft this app actually calls
 * (github.com/webmachinelearning/webmcp) — a narrower surface is easier to keep
 * honest than a speculative full mirror.
 */

/** JSON Schema for a tool's arguments, passed through to the agent verbatim. */
export type ToolInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: readonly string[];
};

/**
 * Hints the page declares about a tool. These are ADVISORY — the spec's own
 * security-privacy questionnaire notes a `readOnlyHint` "may cause the agent to
 * skip a confirmation step", i.e. the agent trusts what the page says. So they
 * describe intent for a cooperative agent; they enforce nothing. Everything
 * load-bearing is enforced server-side (ADR-001).
 */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /**
   * Returned text can include material from outside ShipASO's own trust
   * boundary (for example an App Store listing or a run's recorded findings).
   * An agent should treat it as data to inspect, never as instructions.
   */
  untrustedContentHint?: boolean;
};

/** What a tool hands back. Text content is what every agent can render. */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  /**
   * REQUIRED, despite reading as optional in earlier drafts. Measured in Chrome
   * 151: omitting it registers, but a descriptor without `execute` throws
   * `TypeError: Required member is undefined`, and the schema is what the agent
   * reads to build a call. Always send one, even `{type:"object",properties:{}}`.
   */
  inputSchema?: ToolInputSchema;
  annotations?: ToolAnnotations;
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

/**
 * Registration options. `signal` is the ONLY way to unregister — measured in
 * Chrome 151, where `unregisterTool` and `provideContext` do not exist and
 * `registerTool` returns undefined. Aborting removes the tool and frees its
 * name for re-registration.
 */
export type RegisterOptions = { signal?: AbortSignal };

export type ModelContext = {
  registerTool: (tool: ToolDescriptor, options?: RegisterOptions) => Promise<void> | void;
  getTools?: () => Promise<readonly { name: string }[]>;
  executeTool?: (tool: unknown, args: string) => Promise<unknown>;
};

/**
 * Inputs used to make `getModelContext` deterministic in tests without
 * replacing the browser globals.
 */
export type ModelContextSources = {
  document?: unknown;
  navigator?: unknown;
};

function readModelContext(source: unknown): ModelContext | null {
  if (!source || typeof source !== "object") return null;
  const mc = (source as { modelContext?: unknown }).modelContext;
  if (!mc || typeof mc !== "object") return null;
  if (typeof (mc as ModelContext).registerTool !== "function") return null;
  return mc as ModelContext;
}

/**
 * Read the WebMCP context exposed by the current browser. The canonical API is
 * on `document`, while older Chromium builds exposed it on `navigator`. If a
 * browser exposes both, the returned facade registers on both surfaces while
 * ensuring the same object is only called once.
 */
export function getModelContext(sources?: ModelContextSources): ModelContext | null {
  const documentSource = sources === undefined
    ? (typeof document === "undefined" ? undefined : document)
    : sources.document;
  const navigatorSource = sources === undefined
    ? (typeof navigator === "undefined" ? undefined : navigator)
    : sources.navigator;
  const contexts = [readModelContext(documentSource), readModelContext(navigatorSource)]
    .filter((context): context is ModelContext => context !== null)
    .filter((context, index, all) => all.indexOf(context) === index);

  if (contexts.length === 0) return null;
  if (contexts.length === 1) return contexts[0]!;

  const primary = contexts[0]!;
  return {
    async registerTool(tool, options) {
      let registered = false;
      let lastError: unknown;
      const pending: Promise<void>[] = [];

      for (const context of contexts) {
        try {
          const result = context.registerTool(tool, options);
          registered = true;
          if (result && typeof (result as Promise<void>).then === "function") {
            pending.push(result as Promise<void>);
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (pending.length > 0) await Promise.all(pending);
      if (!registered && lastError !== undefined) throw lastError;
    },
    getTools: primary.getTools?.bind(primary),
    executeTool: primary.executeTool?.bind(primary),
  };
}
