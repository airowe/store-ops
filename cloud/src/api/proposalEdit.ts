/**
 * Editable proposals (#39 Part 1) — the pure merge-and-validate gate.
 *
 * On the run page the human can tweak the agent's proposed copy before clearing
 * the approval gate. The server (`decideRun`) must NEVER trust the client: it
 * merges only the editable fields over the agent's proposal and re-runs the
 * engine's REAL `validateCopy`, so an over-limit or keyword-rule-violating edit
 * can never be staged for push. Keeping this as a pure helper makes the gate
 * unit-testable in the fast `node` vitest env (no Worker runtime).
 *
 * Honesty constraints encoded here:
 *  - Only the fields the agent actually proposed are editable. We merge a field
 *    ONLY when it already exists on the proposed copy — editing can never
 *    fabricate a field (e.g. a subtitle/keywords on a no-key run) into existence.
 *  - `description`/`whatsNew` are out of Part 1 scope and are ignored even if a
 *    client sends them.
 *  - Unknown keys are ignored.
 */
import { validateCopy, type CopyFields, type CopyValidation } from "../engine/optimize.js";

/** The fields a human may edit on the run page (mirrors the diff card). */
export const EDITABLE_FIELDS = ["name", "subtitle", "keywords", "promo"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Merge the human's edits over the agent's `proposed` copy (editable fields only)
 * and validate the result with the engine's authoritative `validateCopy`.
 *
 * A field is merged ONLY when:
 *  - it is an editable field (name/subtitle/keywords/promo), AND
 *  - the agent actually proposed it (it exists on `proposed`), AND
 *  - the edit supplies a string value.
 *
 * Returns the finalized `copy` (the exact shape every downstream handoff reads)
 * plus the `validation`. The caller MUST reject (HTTP 400) when `!validation.pass`.
 */
export function finalizeEditedCopy(
  proposed: CopyFields,
  editedCopy: Partial<CopyFields>,
): { copy: CopyFields; validation: CopyValidation } {
  // start from a shallow clone so we never mutate the persisted proposal.
  const copy: CopyFields = { ...proposed };

  for (const field of EDITABLE_FIELDS) {
    // only an editable field the agent actually proposed may be overwritten —
    // editing never fabricates an unseen field into existence (#39 honesty guard).
    if (proposed[field] === undefined) continue;
    const next = editedCopy[field];
    if (typeof next !== "string") continue;
    copy[field] = next;
  }

  return { copy, validation: validateCopy(copy) };
}
