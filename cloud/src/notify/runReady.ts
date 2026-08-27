/**
 * Compose the `run_ready` notification — "Autopilot put work at your gate".
 *
 * This closes #493 ("weekly runs generate 3–4 proposals each and tell no one —
 * 'detected' is a silent drawer"). A queue nobody is told about is not a queue,
 * and the WebMCP entry's whole proposition is that a standing agent worked while
 * you were away, which requires something to say so.
 *
 * PURE and channel-neutral: it returns a `Notification`, and each Deliverer
 * renders it natively. Two project invariants (CLAUDE.md) are enforced here
 * rather than left to each transport:
 *
 *   MEASURED-OR-NOTHING. The count comes from the fields actually passed in. An
 *   empty list produces NO count at all — not "0 proposals", not "some". The
 *   notification still fires, because a run at the gate is worth knowing about
 *   even when we cannot enumerate what changed.
 *
 *   APPROVAL IS THE TERMINUS. Nothing here says or implies anything shipped or
 *   will ship. Approving is a decision; shipping happens later, from the user's
 *   own machine with their own credentials.
 */
import type { Notification } from "./channel.js";

export type RunReadyInput = {
  appName: string;
  runId: string;
  dashboardUrl: string;
  /** Fields the run actually proposes a change for. Empty ⇒ no count is claimed. */
  changedFields: readonly string[];
};

export function composeRunReady(input: RunReadyInput): Notification {
  const n = input.changedFields.length;
  const base = input.dashboardUrl.replace(/\/+$/, "");

  // Measured-or-nothing: the count appears ONLY when we have one.
  const title = n > 0
    ? `${input.appName} — ${n} ${n === 1 ? "proposal" : "proposals"} waiting for you`
    : `${input.appName} — a run is waiting for you`;

  // The body must stand alone: an SMS or a push gets this line and nothing else,
  // so it carries the app name and the ask without relying on the url or lines.
  const body = n > 0
    ? `Autopilot drafted ${n === 1 ? "a change" : "changes"} for ${input.appName} and stopped at your approval gate. Nothing changes until you approve it.`
    : `Autopilot finished a run for ${input.appName} and stopped at your approval gate. Nothing changes until you approve it.`;

  return {
    kind: "run_ready",
    title,
    body,
    url: `${base}/runs/${input.runId}`,
    ...(n > 0 ? { lines: input.changedFields.map((f) => `${f} — proposed change`) } : {}),
  };
}
