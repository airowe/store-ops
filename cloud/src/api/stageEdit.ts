/**
 * Staging a proposal edit — the agent's one write at the approval gate.
 *
 * `stage_for_approval` is what makes the WebMCP surface more than a reader: a
 * visitor's agent can draft a better subtitle and put it in front of the human,
 * who then approves the version they actually want. What it must NOT do is move
 * the run: staging changes WHAT would be approved, never WHETHER it is.
 *
 * So this is deliberately the approve path's validation WITHOUT its decision.
 * It reuses `finalizeEditedCopy` — the same merge and the same authoritative
 * `validateCopy` — so an agent can never stage copy a human could not have
 * typed, and the run's status is asserted unchanged on the way out.
 *
 * Pure, so the policy is testable without a Request, a DB, or the runtime.
 */
import { finalizeEditedCopy, EDITABLE_FIELDS } from "./proposalEdit.js";
import type { CopyFields } from "../engine/optimize.js";

/** The status a run must be in for staging to mean anything. */
export const STAGEABLE_STATUS = "awaiting_approval";

export type StageDecision =
  | { ok: true; copy: CopyFields; status: typeof STAGEABLE_STATUS }
  | { ok: false; status: number; error: string };

/**
 * Decide whether this edit may be staged onto the run.
 *
 * Refuses, in order: a run past the gate (nothing to stage onto), an edit that
 * touches no field the agent actually proposed (a no-op write, or an attempt to
 * fabricate a field the run never had), and copy that fails validation.
 */
export function stageDecision(
  proposed: CopyFields,
  edit: Partial<CopyFields>,
  runStatus: string,
): StageDecision {
  if (runStatus !== STAGEABLE_STATUS) {
    return {
      ok: false,
      status: 409,
      error: `this run is ${runStatus}, not awaiting approval — there is nothing to stage onto`,
    };
  }

  // An edit must land on a field the agent PROPOSED. Editing never invents a
  // field into existence (the #39 honesty guard), so an edit naming only absent
  // fields is not a partial success — it is a no-op, and we say so.
  const applicable = EDITABLE_FIELDS.filter(
    (f) => proposed[f] !== undefined && typeof edit[f] === "string",
  );
  if (applicable.length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        "no editable field in this edit — send one of " +
        `${EDITABLE_FIELDS.join(", ")} that this run actually proposed`,
    };
  }

  const { copy, validation } = finalizeEditedCopy(proposed, edit);
  if (!validation.pass) {
    const failing = validation.checks.filter((c) => !c.ok);
    return {
      ok: false,
      status: 400,
      error: `edited copy fails validation: ${failing
        .map((c) => `${c.field} (${c.issues.join("; ")})`)
        .join(", ")}`,
    };
  }

  return { ok: true, copy, status: STAGEABLE_STATUS };
}
