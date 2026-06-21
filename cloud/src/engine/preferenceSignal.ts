/**
 * RLHF preference signal (#39 Part 2) — PURE diff of (agent proposal → human
 * final) per editable field. This module carries the PLAINTEXT values and an
 * `edited` flag; encryption + the anonymous, opt-out-gated persistence happen at
 * the d1 layer (`captureProposalEdits`). Keeping this pure means it runs in the
 * fast node vitest env with no Worker runtime.
 *
 * `edited` uses the SAME normalization as the client's `isNoOpProposal`
 * (lowercase + collapse whitespace + trim) so case/space-only churn is NOT
 * counted as a human edit — the captured signal must reflect a real preference,
 * not a whitespace wobble.
 */
import type { CopyFields } from "./optimize.js";

/** Every field a human can edit before approval (per the owner's decision). */
export const EDITABLE_FIELDS = [
  "name",
  "subtitle",
  "keywords",
  "promo",
  "description",
  "whatsNew",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** One preference row, plaintext (the d1 layer encrypts `proposed`/`final`). */
export type EditRow = {
  field: EditableField;
  decision: "approved" | "rejected";
  edited: boolean;
  proposed: string;
  final: string;
};

/** Lowercase + collapse whitespace + trim — mirrors app.js `isNoOpProposal`. */
function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build the per-field preference rows for a decided run. A field is included only
 * when the AGENT actually proposed it (we never fabricate a field). `edited` is
 * true only on a real (normalized) change. A `rejected` decision still emits rows
 * (negative signal). Values carried are the raw plaintext.
 */
export function buildPreferenceRows(args: {
  proposed: Partial<CopyFields>;
  final: Partial<CopyFields>;
  decision: "approved" | "rejected";
}): EditRow[] {
  const { proposed, final, decision } = args;
  const rows: EditRow[] = [];
  for (const field of EDITABLE_FIELDS) {
    const proposedVal = proposed[field];
    if (proposedVal === undefined) continue; // never invent an unproposed field
    const finalVal = final[field] ?? "";
    rows.push({
      field,
      decision,
      edited: norm(proposedVal) !== norm(finalVal),
      proposed: proposedVal,
      final: finalVal,
    });
  }
  return rows;
}
