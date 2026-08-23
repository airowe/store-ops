/**
 * The compact actor marker for a run LIST.
 *
 * `RunTriggerNote` says "ShipASO opened this run on its own" on the run detail
 * page. In a list there was no such signal: an agent-opened run and a
 * user-requested one rendered identically, which flattens the distinction the
 * product exists to demonstrate.
 *
 * Derived from `runTrigger`'s already-resolved actor rather than re-read from
 * the trace. One resolver, one answer — otherwise a list and a detail page can
 * disagree about who opened the same run, and the fail-closed "system" default
 * would have to be reimplemented (and eventually diverge).
 */
import { runTrigger, type RunTriggerInput } from "./runTrigger.js";

export type RunActorBadge = {
  actor: "agent" | "human" | "system";
  /** Non-colour signal — survives greyscale, screenshots, and colour blindness. */
  glyph: string;
  /** Two-or-three letter form for dense rows. */
  short: string;
  /** Accessible name: the same sentence the detail page shows. */
  label: string;
};

const GLYPH: Record<RunActorBadge["actor"], { glyph: string; short: string }> = {
  agent: { glyph: "◆", short: "Agent" },
  human: { glyph: "●", short: "You" },
  system: { glyph: "○", short: "Auto" },
};

/**
 * null when the run carried no trigger. An older run predating the field gets
 * NO marker: the honest statement about who opened it is none at all, and a
 * default would be an invented fact rendered as confidently as a measured one.
 */
export function runActorBadge(
  trigger: RunTriggerInput | null | undefined,
): RunActorBadge | null {
  const t = runTrigger(trigger);
  if (!t) return null;
  return { actor: t.actor, ...GLYPH[t.actor], label: t.headline };
}
