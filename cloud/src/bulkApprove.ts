/**
 * Bulk-approve planner — PURE. Given a batch of run references, decide which
 * runs may be approved in one shot and which must be skipped (with a reason).
 *
 * The rule is intentionally conservative: a run is approvable ONLY when its
 * status is exactly 'awaiting_approval' (the open human gate). Anything else —
 * already 'shipped', 'rejected', a 'detected' detection-only run, or any other
 * status — is skipped rather than silently approved, so a stale/mis-targeted
 * runId can never flip a closed run.
 *
 * This module makes no DB or network calls. The caller resolves RunRefs (e.g.
 * from `listAppsForUser` + `getRun`), passes them in, then hands the resulting
 * `approvable` runIds to `recordApproval` one by one. Keeping the decision pure
 * makes the policy exhaustively testable in isolation.
 *
 * Dedup: the same runId may appear more than once in the input (e.g. selected
 * twice in the UI). The FIRST occurrence decides its bucket; later refs for an
 * already-seen runId are ignored entirely — an approvable run is approved once,
 * and a skipped run is reported once.
 */

/** A minimal reference to a run: enough to decide approvability. */
export type RunRef = { runId: string; appId: string; status: string };

/** A run that can't be approved, paired with why. */
export type SkippedRun = { runId: string; reason: string };

/** The partition: runIds to approve, and the runs that were skipped. */
export type BulkApprovePlan = {
  approvable: string[];
  skipped: SkippedRun[];
};

/** The single status that opens the human approval gate. */
const APPROVABLE_STATUS = "awaiting_approval";

/**
 * Partition `runs` into approvable runIds and skipped runs.
 *
 * Pure: does not mutate `runs`. Input order is preserved within each bucket,
 * and each runId appears at most once across both buckets (first ref wins).
 */
export function planBulkApprove(runs: RunRef[]): BulkApprovePlan {
  const approvable: string[] = [];
  const skipped: SkippedRun[] = [];
  const seen = new Set<string>();

  for (const run of runs) {
    if (seen.has(run.runId)) continue;
    seen.add(run.runId);

    if (run.status === APPROVABLE_STATUS) {
      approvable.push(run.runId);
    } else {
      skipped.push({
        runId: run.runId,
        reason: `not awaiting approval (status=${run.status})`,
      });
    }
  }

  return { approvable, skipped };
}
