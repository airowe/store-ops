/**
 * The client half of the approval boundary (ADR-001).
 *
 * ADR-001 states the contract this file exists to discharge: "the approve UI
 * MUST call the mint route only from a handler where `event.isTrusted === true`".
 * Centralised here so there is exactly ONE call site to audit, rather than a
 * rule every future approve button is expected to remember.
 *
 * Why `isTrusted` carries the weight: the browser sets it, and script cannot.
 * An agent running in the page holds the user's session and can call `fetch`,
 * and can even call `element.click()` — but the event that dispatches from a
 * scripted click has `isTrusted === false`. So this check is not a speed bump
 * an agent works around; it is a property of the platform.
 *
 * It is also NOT the enforcement. The server refuses an approval with no valid
 * nonce regardless of what this file does — this is the honest client, and the
 * server is the boundary. A rewritten client gets nowhere.
 */
import { approveRunWithNonce, mintApprovalNonce } from "@shipaso/api";
import type { ApiClient, RunDecision } from "@shipaso/api";

export const UNTRUSTED_MESSAGE =
  "Approving needs a real click. This call didn't come from one, so nothing was approved.";

/** The single field we need off a React or DOM event. */
type GestureLike = { isTrusted?: unknown };

/**
 * Is this a real user gesture? `=== true`, never coerced: an object carrying
 * `isTrusted: "true"` is exactly what a caller synthesises when trying to look
 * like an event, and a truthy check would wave it through.
 */
export function isTrustedGesture(event: GestureLike | undefined): boolean {
  return event?.isTrusted === true;
}

/**
 * Approve `runId`, but only from a genuine user gesture.
 *
 * MEASURED, not assumed: in jsdom both `fireEvent.click()` and
 * `element.click()` produce `isTrusted === false`. Nothing reachable from
 * script can produce `true` — which is the property the boundary rests on, and
 * also why a component test cannot drive this path with a real click. Tests
 * inject `trust` to exercise what happens AFTER the gesture; production never
 * passes it, so the real button always answers to the browser.
 */
export async function approveFromGesture(
  client: ApiClient,
  runId: string,
  event: GestureLike | undefined,
  trust: (e: GestureLike | undefined) => boolean = isTrustedGesture,
): Promise<RunDecision> {
  if (!trust(event)) throw new Error(UNTRUSTED_MESSAGE);
  const { nonce } = await mintApprovalNonce(client, runId);
  return approveRunWithNonce(client, runId, nonce);
}
