/**
 * The compact "who opened this" mark for a run row.
 *
 * Renders nothing without a trigger — inherited from RunTriggerNote's rule,
 * not restated: an older run gets silence rather than a plausible default.
 */
import { runActorBadge } from "./runActorBadge.js";
import type { RunTriggerInput } from "./runTrigger.js";

export function RunActorMark({ trigger }: { trigger?: RunTriggerInput | null }) {
  const badge = runActorBadge(trigger);
  if (!badge) return null;

  return (
    <span
      className={`run-actor is-${badge.actor}`}
      data-testid="run-actor"
      data-actor={badge.actor}
      role="img"
      aria-label={badge.label}
      title={badge.label}
    >
      {badge.glyph}
    </span>
  );
}
