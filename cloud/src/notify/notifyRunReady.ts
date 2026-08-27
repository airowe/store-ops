/**
 * Tell a user that a run reached the approval gate.
 *
 * ONE dispatch point on purpose. Runs are opened from six call sites today
 * (connect, manual, manual-ASC, and the keyed sweep's two paths) and that list
 * only ever grows — a notification wired per-site is one the seventh site
 * silently forgets. Callers hand over what they already know; this decides
 * whether to speak and to whom.
 *
 * NEVER THROWS. A notification is bookkeeping about a run, never the run
 * itself: no delivery failure, missing pref, or dead transport may cost a user
 * the work the agent just did. Every exit returns a result instead.
 *
 * Dependencies are injected rather than imported so the gating policy is
 * testable without a DB or a network.
 */
import { deliverAll, type Deliverer, type Destination, type DeliveryResult } from "./channel.js";
import { composeRunReady } from "./runReady.js";

/** The ONE status that means "a human decision is now required". */
const GATE_STATUS = "awaiting_approval";

export type NotifyRunReadyResult = {
  sent: number;
  failed: number;
  /** Why nothing was sent, when nothing was. */
  skipped?: "not-at-gate" | "opted-out" | "no-destinations" | "error";
};

export type NotifyRunReadyInput = {
  userId: string;
  appName: string;
  runId: string;
  /** The run's status. Anything but the gate is silence. */
  status: string;
  /** Fields the run proposes a change for. Empty ⇒ no count is claimed. */
  changedFields: readonly string[];
  dashboardUrl: string;
  wantsRunReady: (userId: string) => Promise<boolean>;
  destinationsFor: (userId: string) => Promise<Destination[]>;
  deliverers: readonly Deliverer[];
  record?: (r: DeliveryResult) => Promise<void>;
};

export async function notifyRunReady(
  input: NotifyRunReadyInput,
): Promise<NotifyRunReadyResult> {
  try {
    // Gate check FIRST — cheapest, and it is the definition of the event. A
    // 'detected' run has crossed no threshold a human must rule on.
    if (input.status !== GATE_STATUS) return { sent: 0, failed: 0, skipped: "not-at-gate" };

    // Preference BEFORE reading destinations: an opted-out user's addresses are
    // none of this code's business.
    if (!(await input.wantsRunReady(input.userId))) {
      return { sent: 0, failed: 0, skipped: "opted-out" };
    }

    const destinations = await input.destinationsFor(input.userId);
    if (destinations.length === 0) return { sent: 0, failed: 0, skipped: "no-destinations" };

    const note = composeRunReady({
      appName: input.appName,
      runId: input.runId,
      dashboardUrl: input.dashboardUrl,
      changedFields: input.changedFields,
    });

    const results = await deliverAll(note, destinations, input.deliverers);
    for (const r of results) {
      // Bookkeeping is best-effort: a failed write about a delivery must not
      // discard the delivery that already happened.
      await input.record?.(r).catch(() => {});
    }
    return {
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  } catch (e) {
    console.error("[store-ops] run_ready notification failed (non-fatal):", e);
    return { sent: 0, failed: 0, skipped: "error" };
  }
}
