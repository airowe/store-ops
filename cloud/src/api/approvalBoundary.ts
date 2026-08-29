/**
 * The approval boundary (ADR-001) — the two server-side gates that make
 * "only a human approves" a property rather than a promise.
 *
 * Context: a browser agent runs IN the page with the user's own session. Not
 * advertising a WebMCP approve tool does not remove the capability — a scripted
 * fetch can still POST the endpoint. WebMCP's own security-privacy questionnaire
 * notes that a page-declared `readOnlyHint` "may cause the agent to skip a
 * confirmation step", i.e. page-declared tool semantics get trusted. These two
 * checks are the answer: the boundary is enforced where the agent cannot reach.
 *
 *   • requireApprovalChallenge — POST /runs/:id/approve needs the single-use
 *     challenge issued with the run view, spent in the same UPDATE that checks
 *     it. Replay and re-mint both fail; a caller that never opened the run has
 *     no challenge to present.
 *   • requireHumanSession — POST /runs/approve-all accepts ONLY a cookie
 *     session. Bearer tokens (API keys, agent credentials) and the demo-env
 *     header are refused.
 *
 * KNOWN GAP (#515): approve-all is exempt from the challenge, so
 * requireHumanSession is the whole of its gate — and a browser-resident agent
 * runs on the user's own cookie, which that check admits. It stops API keys,
 * not an agent in the tab, which is the threat this boundary exists for.
 *
 * requireHumanSession is a PURE decision over an already-resolved input;
 * requireApprovalChallenge needs the DB because single-use is a fact about
 * stored state, not something a token can carry.
 */
import { consumeApprovalChallenge } from "../d1.js";
import type { AuthMethod } from "./index.js";

/**
 * A refusal, shaped so a machine can act on it.
 *
 * A human never sees this body — the UI renders its own message. This is for
 * whoever called the endpoint directly, which is a script or an agent. A bare
 * 403 leaves it guessing (retry? different endpoint? broken auth?); naming the
 * boundary and listing what IS available turns a dead end into a handoff.
 *
 * THE RULE (ADR-001): a caller's self-description may change what we TELL them,
 * never what we PERMIT. Nothing in this shape grants anything — `youCan` lists
 * capabilities the caller already had, and no entry may cross the gate.
 */
export type BoundaryRefusal = {
  ok: false;
  status: number;
  /** Human-readable. Kept because a person reads server logs. */
  error: string;
  /** Stable machine code — safe to branch on, unlike the prose. */
  boundary: "human-approval-required";
  /** What this caller CAN do here. Never includes anything gate-crossing. */
  youCan: readonly string[];
  /** The act only a person can perform. */
  humanMustDo: string;
};

export type BoundaryVerdict = { ok: true } | BoundaryRefusal;

/**
 * The read-and-draft capabilities that remain open to an agent at the gate.
 * Deliberately excludes anything that approves, ships, or pushes — a test
 * asserts that, so this list cannot drift into granting by accident.
 */
const AGENT_CAPABILITIES = [
  "explain_run",
  "draft_alternative",
  "stage_for_approval",
  "get_run",
  "list_pending_runs",
] as const;

/**
 * May this caller use BULK approve? Cookie sessions only.
 *
 * Bearer is refused even though it is a perfectly valid credential elsewhere:
 * approve-all is deliberately exempt from the per-run nonce (it is a live
 * dashboard ergonomic and a trusted gesture per run would defeat it), so
 * without this check it would be the way around the nonce.
 */
export function requireHumanSession(auth: AuthMethod): BoundaryVerdict {
  if (auth === "cookie") return { ok: true };
  return {
    ok: false,
    status: 403,
    error:
      "Bulk approval requires a signed-in browser session. Approving is a human " +
      "gesture in ShipASO — an API key or agent credential can read and draft, but " +
      "cannot approve. Open the run in the dashboard and approve it there.",
    boundary: "human-approval-required",
    youCan: AGENT_CAPABILITIES,
    humanMustDo: "approve in the dashboard, signed in, one run at a time",
  };
}

/** The header the run view's challenge rides back on. */
export const APPROVAL_CHALLENGE_HEADER = "x-approval-challenge";

/**
 * Does this request carry the single-use challenge issued with the run view?
 *
 * WHAT REPLACED WHAT, AND WHY: the first design minted a stateless HMAC nonce
 * from `POST /runs/:id/approval-nonce`. Measured against production, a plain
 * scripted fetch carrying the user's cookie received a valid nonce — the route
 * existed to vend approval credentials and could not tell an agent from a
 * person. A second attempt gated that route on `Sec-Fetch-*`, which
 * distinguishes our page from another SITE but not a human from script running
 * INSIDE our page, which is the actual threat. Both are gone.
 *
 * The challenge is issued when a person opens a run and spent when the run is
 * approved. Being server-tracked is what a stateless token could never be:
 * single-use. `consumeApprovalChallenge` marks it in the same UPDATE that
 * checks it, so a replay — or two concurrent approvals racing — matches no rows
 * the second time.
 *
 * HONEST LIMIT, recorded rather than papered over: an agent in the page can
 * read the run view and therefore the challenge. This does NOT prove a human
 * clicked, and nothing server-side can — `isTrusted` is a browser fact that
 * never crosses the network. What it removes is the credential-vending
 * endpoint, unlimited re-minting, replay, and approval by a caller that never
 * loaded the run. The client still requires a trusted gesture; that check is
 * the honest client, not the boundary.
 */
export async function requireApprovalChallenge(
  env: { DB: D1Database },
  user: { id: string },
  runId: string,
  presented: { challenge: string | null },
): Promise<BoundaryVerdict> {
  const refused: BoundaryRefusal = {
    ok: false,
    status: 403,
    error:
      "Approving requires the single-use challenge issued when this run was " +
      "opened. This request carried none, or one already spent, so nothing was " +
      "approved. An agent can read, draft and stage a proposal — approving it " +
      "is the person's step.",
    boundary: "human-approval-required",
    youCan: AGENT_CAPABILITIES,
    humanMustDo: "open the run and approve it there",
  };
  const challenge = presented.challenge?.trim();
  if (!challenge) return refused;
  const ok = await consumeApprovalChallenge(env.DB, { challenge, runId, userId: user.id });
  return ok ? { ok: true } : refused;
}
