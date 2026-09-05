/**
 * Recorded proposals (#493) — the output of `detected` runs, counted honestly.
 *
 * The weekly sweep writes a `detected` run when no threshold crossed: the
 * time-series stays complete without nagging. Those runs are not empty — each
 * carries the copy the agent actually wrote — and until now that output was
 * persisted and surfaced nowhere. This module counts it so the digest and the
 * dashboard can say "N proposals recorded this week, not pushed to you because
 * no rank moved" — discoverable, not a nag.
 *
 * A "proposal" is a listing field whose proposed value is non-empty and differs
 * from the current one. Unchanged fields are not proposals; an empty proposed
 * field is not a proposal. Pure: no DB, no network.
 */
import { listRunsForApp, type ReasoningTrace } from "./d1.js";
import type { RunStatus } from "./engine/constants.js";

export type RecordedProposals = {
  /** `detected` runs in the window. */
  runs: number;
  /** Proposed fields across those runs that differ from the current copy. */
  proposals: number;
  /** ISO start of the window the counts cover. */
  since: string;
};

const COPY_FIELDS = ["name", "subtitle", "keywords", "promo", "description", "whatsNew"] as const;

/** How many proposed fields differ from the current copy. */
export function countProposedFields(
  proposed: Partial<Record<(typeof COPY_FIELDS)[number], unknown>> | null | undefined,
  current: Partial<Record<(typeof COPY_FIELDS)[number], unknown>> | null | undefined,
): number {
  if (!proposed) return 0;
  let n = 0;
  for (const k of COPY_FIELDS) {
    const p = proposed[k];
    if (typeof p !== "string" || p.trim() === "") continue;
    const c = current?.[k];
    if (typeof c === "string" && c.trim() === p.trim()) continue;
    n++;
  }
  return n;
}

/** The count over an app's runs, restricted to `detected` runs created at or after `since`. */
export function recordedProposalsSince(
  runs: ReadonlyArray<{ status: RunStatus | string; created_at: string; reasoning_json: string }>,
  since: Date,
): RecordedProposals {
  const sinceIso = since.toISOString();
  let runCount = 0;
  let proposals = 0;
  for (const r of runs) {
    if (r.status !== "detected") continue;
    if (Date.parse(r.created_at) < since.getTime()) continue;
    runCount++;
    let trace: Partial<ReasoningTrace> | null = null;
    try {
      trace = JSON.parse(r.reasoning_json) as Partial<ReasoningTrace>;
    } catch {
      continue; // a run whose trace cannot be read contributes nothing — never a guess
    }
    proposals += countProposedFields(trace?.proposedCopy ?? null, trace?.currentCopy ?? null);
  }
  return { runs: runCount, proposals, since: sinceIso };
}

/** The window the weekly surfaces use: the last seven days from `now`. */
export function weekBefore(now: Date): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

/**
 * The last week's recorded proposals for one app, read from D1. Returns
 * undefined — not a zero — when the runs cannot be read: a digest or a list
 * must never lose the rest of its content to this line, and "unknown" is not
 * "none".
 */
export async function recordedProposalsFor(
  db: D1Database,
  appId: string,
  now: Date = new Date(),
): Promise<RecordedProposals | undefined> {
  try {
    return recordedProposalsSince(await listRunsForApp(db, appId), weekBefore(now));
  } catch {
    return undefined;
  }
}
