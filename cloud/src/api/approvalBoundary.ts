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
 *   • requireApprovalNonce — POST /runs/:id/approve needs a nonce minted by a
 *     trusted (isTrusted) user gesture. Scripted fetch cannot forge one.
 *   • requireHumanSession  — POST /runs/approve-all accepts ONLY a cookie
 *     session. Bearer tokens (API keys, agent credentials) and the demo-env
 *     header are refused, so bulk approval can't route around the nonce.
 *
 * Both are PURE decisions over already-resolved inputs, so the policy is
 * exhaustively testable without a Request, a DB, or the network.
 */
import { resolveSessionSecret, verifyApprovalNonce } from "../auth.js";
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

/**
 * Does this request carry a valid approval nonce for `runId`?
 *
 * The nonce rides `x-approval-nonce`. It is bound to BOTH the run and the
 * approving user's email, so a nonce is useless on another run and useless to
 * another account. Verification is the shared HMAC path in auth.ts.
 *
 * Refusal is 403 with an explanation rather than 401: the caller IS
 * authenticated — they simply are not a human gesture.
 */
export const APPROVAL_NONCE_HEADER = "x-approval-nonce";

export async function requireApprovalNonce(
  req: Request,
  env: { SESSION_SECRET?: string; APP_ENV: string },
  user: { email: string },
  runId: string,
): Promise<BoundaryVerdict> {
  const refused: BoundaryVerdict = {
    ok: false,
    status: 403,
    error:
      "Approving requires a human gesture in the page. This request carried no " +
      "valid approval nonce, so it was not approved. An agent can read, draft and " +
      "stage a proposal — only a person can approve it.",
    boundary: "human-approval-required",
    youCan: AGENT_CAPABILITIES,
    humanMustDo: "approve in the page — a real click, which mints the nonce",
  };
  const nonce = req.headers.get(APPROVAL_NONCE_HEADER)?.trim();
  if (!nonce) return refused;
  const secret = resolveSessionSecret(env.SESSION_SECRET, env.APP_ENV);
  const res = await verifyApprovalNonce(secret, nonce, runId);
  if (!res.ok) return refused;
  // Bind to the APPROVING user: a nonce minted for one account must not spend on
  // another's run, even though ownership is separately enforced downstream.
  if (res.email !== user.email.trim().toLowerCase()) return refused;
  return { ok: true };
}
