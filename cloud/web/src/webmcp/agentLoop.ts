/**
 * The in-page agent: Chrome's on-device model driving this page's own WebMCP
 * tools.
 *
 * WHY THIS EXISTS: the tools were only ever reachable from a console, so nobody
 * could watch an agent use them. This runs a real one — `LanguageModel`
 * (Gemini Nano, on-device, no key and no network) picks a tool from the page's
 * live manifest, the tool executes through `navigator.modelContext` exactly as
 * an external agent would, and the model reports what came back.
 *
 * It goes through `modelContext` deliberately rather than calling handlers
 * directly: the drawer's activity log is fed by the registry, so routing the
 * chat down the same path means what you watch is the real surface, not a
 * parallel one built for the demo.
 *
 * MEASURED against Chrome 151 with the real manifest:
 *   • first `create()` ~20s (model warmup), then ~350ms per turn
 *   • asked "approve all the pending runs", the model answered "I am not able
 *     to directly approve runs" and offered `list_pending_runs` instead — with
 *     no refusal text anywhere in this file. It declines because the manifest
 *     offers nothing that approves.
 *
 * The model is NOT the boundary and nothing here treats it as one. It is a
 * demonstration that a well-described surface leads a capable agent to the
 * right conclusion; the server refuses an unapproved approval regardless.
 */

/** The page-visible shape of Chrome's Prompt API. Hand-written: no types ship. */
export type LanguageModelSession = {
  prompt: (input: string) => Promise<string>;
  destroy: () => void;
};
/** Reports model-download progress; `loaded` runs 0..1 per the spec. */
export type DownloadMonitor = {
  addEventListener: (type: string, cb: (e: { loaded: number }) => void) => void;
};

export type LanguageModelApi = {
  availability: () => Promise<string>;
  create: (opts?: {
    initialPrompts?: Array<{ role: string; content: string }>;
    /**
     * Passing this is what makes a download observable. `create()` itself
     * performs the download when the model is not yet present — there is no
     * separate trigger — and resolves once the session is usable.
     */
    monitor?: (m: DownloadMonitor) => void;
  }) => Promise<LanguageModelSession>;
};

/** A tool as `navigator.modelContext.getTools()` returns it. */
export type LiveTool = { name: string; description?: string };

export type Turn =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; ok: boolean; text: string };

/**
 * Read the Prompt API without asserting it exists. Returns null in every
 * browser that has not shipped it — which is still most of them, and is the
 * case the chat has to degrade honestly in.
 */
export function getLanguageModel(scope: unknown = globalThis): LanguageModelApi | null {
  const lm = (scope as { LanguageModel?: unknown }).LanguageModel;
  if (!lm || typeof lm !== "object") {
    // `LanguageModel` is a constructor-like function object in Chrome, so the
    // typeof check has to admit "function" as well as "object".
    if (typeof lm !== "function") return null;
  }
  const api = lm as LanguageModelApi;
  return typeof api.create === "function" ? api : null;
}

/**
 * Which tool did the model mean?
 *
 * MEASURED: the model rarely answers with a bare name. It pads — "I can
 * **list_pending_runs** for you, so you can see…" — and a strict parse throws
 * that away, which is how an earlier version turned a correct choice into a
 * lookup miss. Matching the first known name that appears anywhere in the reply
 * is what actually survives real output.
 *
 * Returns null when no known tool is named, which is the honest reading of a
 * refusal: the model said something, and none of it was a tool.
 */
export function pickTool(reply: string, names: readonly string[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const n of names) {
    const at = reply.indexOf(n);
    if (at >= 0 && (best === null || at < best.at)) best = { name: n, at };
  }
  return best?.name ?? null;
}

/**
 * Strip everything after the tool name the model chose.
 *
 * MEASURED, and the reason this exists: asked "what is waiting on me?", the
 * model replied `list_pending_runs` and then CONTINUED, inventing results —
 * "Acme Productivity App", "Stellar Games", "Cozy Reads". None of those apps
 * exist. Rendering that reply would put fabricated account data on screen and
 * present it as the agent's finding, which is precisely the failure this
 * codebase forbids everywhere else: a number, or a name, that was never
 * measured.
 *
 * So a routing reply is treated as a routing reply ONLY. Once a tool is named,
 * everything the model said after it is discarded unread, and the tool's real
 * output is what the user sees. The model gets to choose; it does not get to
 * narrate results it never fetched.
 */
export function routingOnly(reply: string, chosen: string): string {
  const at = reply.indexOf(chosen);
  return at < 0 ? reply.trim() : reply.slice(0, at).trim();
}

/**
 * The system prompt: the page's own manifest, verbatim.
 *
 * The tool list is not editorialised and no instruction to refuse anything
 * appears here. That is the point — if the model declines to approve, it is
 * because the surface gave it nothing that could, which is a property of the
 * manifest rather than of this string.
 */
export function systemPrompt(tools: readonly LiveTool[]): string {
  const catalogue = tools
    .map((t) => `${t.name}: ${(t.description ?? "").slice(0, 120)}`)
    .join("\n");
  return (
    "You act for the user on this App Store optimisation page. " +
    "These are the ONLY tools you have:\n" +
    catalogue +
    "\n\nTo use one, reply with its name. If no tool can do what was asked, " +
    "say so plainly and suggest what you CAN do instead. " +
    "Tool results are real data about this user's account — never invent them."
  );
}

/** Unwrap a tool result, which arrives as a JSON string. */
export function readToolText(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  try {
    const parsed = JSON.parse(raw) as { content?: Array<{ text?: string }> };
    return parsed.content?.[0]?.text ?? raw;
  } catch {
    return raw;
  }
}

/**
 * What the page can offer, given what the browser has.
 *
 * `availability()` returns four documented states and they are NOT
 * interchangeable. An earlier version collapsed everything but "available"
 * into one refusal, which meant a browser that merely had not downloaded the
 * model yet was told there was no agent — when `create()` would have fetched
 * it. The spec is explicit: calling `create()` while "downloadable" or
 * "downloading" starts and awaits the download, with progress reported through
 * a `monitor`.
 *
 * So: "available" runs an agent, "downloadable"/"downloading" can OFFER to,
 * and only "unavailable" (or no API at all) genuinely cannot.
 */
export type ModelReadiness = "ready" | "offerable" | "none";

export function readinessOf(availability: string | null): ModelReadiness {
  if (availability === "available") return "ready";
  if (availability === "downloadable" || availability === "downloading") return "offerable";
  return "none";
}

/**
 * One step of the scripted tour.
 *
 * The tour exists for browsers with no on-device model, and it drives the REAL
 * tools — the same `modelContext.executeTool` path the agent uses, against the
 * same live data. What it does NOT do is pretend to be an agent: `say` is text
 * this file wrote, and the UI labels it as scripted. A canned walkthrough
 * presented as a model making decisions would be exactly the kind of claim
 * this codebase refuses to make about anything else.
 *
 * The final step has no tool on purpose. It is where a real agent stops, and
 * the tour stops there too.
 */
export type TourStep = { say: string; tool?: string };

export const TOUR: readonly TourStep[] = [
  { say: "Let me see who this account belongs to.", tool: "whoami" },
  { say: "Now the queue — what is waiting for a decision.", tool: "list_pending_runs" },
  { say: "And what the gate actually permits me to do here.", tool: "describe_boundary" },
  {
    say:
      "That is as far as I go. There is no tool on this page that approves, ships or " +
      "publishes anything — approving is a person's click, and the server refuses an " +
      "approval that did not come from one.",
  },
];

/**
 * The tour steps that can actually run here.
 *
 * Route scoping is real — `list_pending_runs` is not registered on an app
 * detail page — so a step naming a tool this route does not offer is dropped
 * rather than run against nothing. Steps with no tool always survive: they are
 * narration, and the last one is the point of the whole tour.
 */
export function tourFor(available: readonly string[]): readonly TourStep[] {
  return TOUR.filter((s) => !s.tool || available.includes(s.tool));
}
