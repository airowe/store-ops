/**
 * "Why is this run here?" — the agent's own account, rendered.
 *
 * Every run has carried a `trigger` ({source, reasons[]}) since runs existed,
 * and until now nothing displayed it. The product's claim is that the agent
 * decides and the human approves; showing the decision without its reason asks
 * for approval on trust rather than on evidence.
 *
 * Derived, never stored, so it cannot drift from the trigger it describes.
 *
 * Two rules, both load-bearing:
 *
 *   1. The actor is never overstated. A run the human asked for is not narrated
 *      as something ShipASO noticed, and a `source` this code has never seen
 *      resolves to "system" rather than being credited to the agent.
 *   2. Reasons pass through verbatim. They are the measured evidence the sweep
 *      recorded; this module may order and label them, never author them. No
 *      reasons means an empty list, never a plausible-sounding stand-in.
 */

/** The persisted trigger shape (d1.ts ReasoningTrace["trigger"]). */
export type RunTriggerInput = {
  source: "manual" | "cron" | "connect";
  reasons: string[];
};

export type RunTriggerView = {
  /**
   * Who caused this run. Drives whether the UI frames it as an agent decision.
   * "system" is the fail-closed default for anything unrecognized.
   */
  actor: "agent" | "human" | "system";
  /** The sentence above the reasons. */
  headline: string;
  /** The measured reasons, verbatim. Empty when the trace carried none. */
  reasons: string[];
};

export function runTrigger(
  input: RunTriggerInput | null | undefined,
): RunTriggerView | null {
  // No trigger ⇒ nothing to say about why this run exists. An older run that
  // predates the field gets no narration rather than an invented one.
  if (!input) return null;

  const reasons = Array.isArray(input.reasons) ? input.reasons : [];

  switch (input.source) {
    case "cron":
      return {
        actor: "agent",
        headline: "ShipASO opened this run on its own.",
        reasons,
      };
    case "manual":
      return {
        actor: "human",
        headline: "You asked for this run.",
        reasons,
      };
    case "connect":
      return {
        actor: "system",
        headline: "First look, from when this app was connected.",
        reasons,
      };
    default:
      // Fails closed. A source added later must not be silently credited to the
      // agent — that would be this module authoring a claim about autonomy.
      return {
        actor: "system",
        headline: "This run was opened automatically.",
        reasons,
      };
  }
}
