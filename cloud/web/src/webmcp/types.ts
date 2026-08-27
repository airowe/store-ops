/**
 * WebMCP (`navigator.modelContext`) typings.
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
};

/** What a tool hands back. Text content is what every agent can render. */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  annotations?: ToolAnnotations;
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

/** Returned by registerTool so a caller can drop one tool without a full sweep. */
export type RegisteredTool = { unregister: () => void };

export type ModelContext = {
  registerTool: (tool: ToolDescriptor) => RegisteredTool | void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: { tools?: readonly ToolDescriptor[] }) => void;
  clearContext?: () => void;
};

/**
 * Read `navigator.modelContext` without asserting it exists. Returns null in
 * every browser that has not shipped WebMCP (today: nearly all of them), which
 * is the case the whole surface has to stay usable in.
 */
export function getModelContext(nav: unknown = typeof navigator === "undefined" ? undefined : navigator): ModelContext | null {
  if (!nav || typeof nav !== "object") return null;
  const mc = (nav as { modelContext?: unknown }).modelContext;
  if (!mc || typeof mc !== "object") return null;
  if (typeof (mc as ModelContext).registerTool !== "function") return null;
  return mc as ModelContext;
}
