/**
 * "ShipASO opened this run on its own" — and what it saw.
 *
 * Sits directly under the verdict: the verdict says what to do, this says why
 * there is anything to do at all. Without it the run page asks for approval on
 * trust; the agent's observations were measured and persisted, and the person
 * being asked to approve is the one who should see them.
 *
 * Renders nothing when the run carried no trigger. An older run predating the
 * field gets silence, not a plausible-sounding reconstruction.
 */
import type { RunTrigger } from "@shipaso/api";
import { runTrigger } from "./runTrigger.js";

export function RunTriggerNote({ trigger }: { trigger?: RunTrigger | null | undefined }) {
  const t = runTrigger(trigger);
  if (!t) return null;

  return (
    <div className="run-trigger" data-testid="run-trigger" data-actor={t.actor}>
      <p className="run-trigger-headline">{t.headline}</p>
      {t.reasons.length > 0 ? (
        <ul className="run-trigger-reasons" data-testid="run-trigger-reasons">
          {t.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
