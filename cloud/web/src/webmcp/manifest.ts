/**
 * The WebMCP tool manifest — what a visitor's own browser agent can do in this
 * page, declared in one place so it can be tested as a whole.
 *
 * The shape of the entry: Autopilot proposes, the agent triages, the human
 * approves. So the manifest is deliberately LOPSIDED — rich in reading,
 * explaining and drafting; empty of anything that crosses the approval gate.
 * `manifest.spec.ts` asserts that as a property over every tool, present and
 * future, rather than trusting this comment.
 *
 * Not advertising an approve tool would be cosmetic on its own: an agent in the
 * page holds the user's session and can POST the endpoint regardless. The
 * boundary is enforced server-side (ADR-001); this manifest is the honest
 * DESCRIPTION of that boundary, not its implementation.
 */

/** Verbs that would cross the gate. Used by the manifest test as a tripwire. */
export const GATE_CROSSING_VERBS = ["approve", "ship", "push", "publish", "submit"] as const;

/**
 * Where a tool is offered. "*" is every route; other entries are matched
 * against the route PATTERN, not the literal pathname, so "/runs/$id" covers
 * "/runs/r_0193…". Per-route scoping is the point: an agent landing on the run
 * list should be offered triage tools, not the whole API surface at once.
 */
export type RoutePattern = "*" | "/" | "/runs" | "/runs/$id" | "/apps/$id" | "/dashboard";

export type ToolSpec = {
  name: string;
  description: string;
  /** Does calling this change server state? Drives the panel's legend. */
  writes: boolean;
  /** Advertised via annotations.readOnlyHint. Must be the inverse of `writes`. */
  readOnly: boolean;
  /**
   * Advertised via annotations.untrustedContentHint. The result includes
   * external or user-controlled text, which an agent must treat as data rather
   * than instructions.
   */
  untrustedContent?: boolean;
  routes: readonly RoutePattern[];
  /** Short label for the panel — the tool's effect in a few words. */
  effect: string;
  /**
   * What the agent may pass. Omit for a tool that takes nothing — the registry
   * substitutes an empty object schema.
   *
   * This is not decoration: an agent reads the schema to construct its call, so
   * a tool whose handler reads `runId` while advertising no properties is
   * callable only by accident. Every named argument a handler consumes belongs
   * here.
   */
  inputSchema?: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: readonly string[];
  };
};

export const MANIFEST: readonly ToolSpec[] = [
  // ── global ────────────────────────────────────────────────────────────────
  {
    name: "whoami",
    description:
      "Report who is signed in and what this page can do for them: the account email, " +
      "the number of apps under Autopilot, and how many runs are waiting at the approval gate.",
    writes: false,
    readOnly: true,
    routes: ["*"],
    effect: "reads the session",
  },
  {
    name: "describe_boundary",
    description:
      "Explain the approval boundary: which actions an agent may take here, and which " +
      "single action only a person can take. Call this before attempting to approve anything.",
    writes: false,
    readOnly: true,
    routes: ["*"],
    effect: "explains the gate",
  },
  // ── landing ───────────────────────────────────────────────────────────────
  {
    name: "search_app",
    description:
      "Search the App Store for an app by name and return the candidate matches with their " +
      "identifiers, so the right one can be chosen before connecting it to Autopilot.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/"],
    effect: "searches the store",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name or search term." },
      },
      required: ["query"],
    }
  },
  {
    name: "audit_app",
    description:
      "Run a public, credential-free listing audit for an App Store app and return the findings: " +
      "what its current metadata says, and which keyword and conversion opportunities are measurable.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/"],
    effect: "audits a public listing",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name or search term." },
        bundleId: { type: "string", description: "Exact bundle id, e.g. com.acme.app." },
      },
    }
  },
  // ── app detail ────────────────────────────────────────────────────────────
  {
    name: "connect_app",
    description:
      "Put an App Store app under Autopilot so the unattended sweep starts watching it. " +
      "This starts monitoring; it never changes anything on the App Store.",
    writes: true,
    readOnly: false,
    routes: ["/apps/$id"],
    effect: "starts monitoring",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name or search term." },
        bundleId: { type: "string", description: "Exact bundle id, e.g. com.acme.app." },
      },
    }
  },
  {
    name: "trigger_run",
    description:
      "Run the Autopilot sweep for this app now instead of waiting for its next scheduled slot. " +
      "The result is a proposal that stops at the approval gate — nothing is sent to the App Store.",
    writes: true,
    readOnly: false,
    routes: ["/apps/$id"],
    effect: "prepares a proposal",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "The app's id. Defaults to the app open on this page." },
      },
    }
  },
  {
    name: "get_schedule",
    description:
      "Report when the Autopilot sweep next checks this app: its cadence (daily, weekly or " +
      "biweekly), the day and hour it runs in UTC, and the next matching slot.",
    writes: false,
    readOnly: true,
    routes: ["/apps/$id"],
    effect: "reads the cadence",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "The app's id. Defaults to the app open on this page." },
      },
    }
  },
  {
    name: "set_schedule",
    description:
      "Change how often Autopilot checks this app — the cadence, and the UTC day and hour of its " +
      "slot. Affects when proposals are prepared, never whether they are approved.",
    writes: true,
    readOnly: false,
    routes: ["/apps/$id"],
    effect: "changes the cadence",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "The app's id. Defaults to the app open on this page." },
        cadence: { type: "string", description: "How often the sweep runs: \"weekly\", \"daily\" or \"off\"." },
      },
      required: ["cadence"],
    }
  },
  // ── run index ─────────────────────────────────────────────────────────────
  {
    name: "list_pending_runs",
    description:
      "List every run waiting at the approval gate across the account, newest first, with the app " +
      "it belongs to and why Autopilot opened it. This is the triage queue.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/runs", "/dashboard"],
    effect: "reads the queue",
  },
  {
    name: "explain_run",
    description:
      "Explain one run in plain language: what changed in the listing or the competitive set, why " +
      "Autopilot opened a proposal, and what approving it would and would not do.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/runs", "/runs/$id", "/dashboard"],
    effect: "explains a proposal",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run's id. Defaults to the run open on this page." },
      },
    }
  },
  // ── run detail ────────────────────────────────────────────────────────────
  {
    name: "get_run",
    description:
      "Read one run in full: the current listing copy, the proposed copy, the measured findings " +
      "behind it, and the run's status. Push commands stay hidden until a person approves.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/runs/$id"],
    effect: "reads the proposal",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run's id. Defaults to the run open on this page." },
      },
    }
  },
  {
    name: "draft_alternative",
    description:
      "Draft an alternative to the proposed copy — a different title, subtitle or keyword set — " +
      "and return it for comparison. Drafting is not staging: nothing is recorded until it is staged.",
    writes: false,
    readOnly: true,
    untrustedContent: true,
    routes: ["/runs/$id"],
    effect: "drafts an option",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run's id. Defaults to the run open on this page." },
      },
    }
  },
  {
    name: "stage_for_approval",
    description:
      "Record an edit to this run's proposed copy so it is what a person sees at the gate. The run " +
      "stays awaiting approval; staging changes what would be approved, never whether it is.",
    writes: true,
    readOnly: false,
    routes: ["/runs/$id"],
    effect: "edits the proposal",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run's id. Defaults to the run open on this page." },
        title: { type: "string", description: "Replacement app name. 30 characters max." },
        subtitle: { type: "string", description: "Replacement subtitle. 30 characters max." },
        keywords: { type: "string", description: "Replacement keywords: comma-separated, no spaces, 100 characters max." },
        promo: { type: "string", description: "Replacement promotional text. 170 characters max." },
      },
    }
  },
  {
    name: "request_notification",
    description:
      "Ask the account owner to come and decide, on a channel they have already verified — email " +
      "today, more as they are added. Use this when a run needs a person and nobody is watching.",
    writes: true,
    readOnly: false,
    routes: ["/runs", "/runs/$id"],
    effect: "asks a human to look",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run's id. Defaults to the run open on this page." },
      },
    }
  },
];

/**
 * Reduce a live pathname to the route pattern the manifest keys on. Pure.
 *
 * Order matters: "/runs" and "/runs/$id" are DIFFERENT surfaces (a queue versus
 * one proposal), so the exact match is tested before the parameterized one.
 */
export function patternFor(pathname: string): RoutePattern | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "/";
  if (path === "/runs") return "/runs";
  if (path === "/dashboard") return "/dashboard";
  if (/^\/runs\/[^/]+$/.test(path)) return "/runs/$id";
  if (/^\/apps\/[^/]+$/.test(path)) return "/apps/$id";
  return null;
}

/** The tools offered on `pathname`: the globals, plus that route's own. */
export function toolsForRoute(pathname: string): readonly ToolSpec[] {
  const pattern = patternFor(pathname);
  return MANIFEST.filter(
    (t) => t.routes.includes("*") || (pattern !== null && t.routes.includes(pattern)),
  );
}
