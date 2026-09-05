/**
 * #493 — the one-line account of what the last week's `detected` runs wrote
 * without pushing to the user. Mirrors `recordedProposalsLabel` in the web
 * dashboard model so both surfaces say the same sentence.
 *
 * Null when there is nothing honest to say: no count, a zero, or a row that
 * already awaits approval (that row has a louder claim).
 */
import type { AppListItem } from "../types/api.js";

export function recordedProposalsLabel(app: AppListItem): string | null {
  const r = app.recorded_proposals;
  if (!r || r.proposals <= 0) return null;
  if (app.latest_run?.status === "awaiting_approval") return null;
  return `${r.proposals} ${r.proposals === 1 ? "proposal" : "proposals"} recorded · nothing moved`;
}
