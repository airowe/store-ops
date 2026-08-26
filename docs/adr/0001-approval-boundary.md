# ADR-001: The approval boundary is enforced, not advertised

- **Status:** Accepted
- **Date:** 2026-08-26
- **Context:** WebMCP entry (`feat/webmcp`)

## Context

We are exposing WebMCP tools on shipaso.com so a visitor's own browser agent can
work the pending-approval queue: read runs, explain why the agent proposed what
it did, draft alternatives, and hand the human a decision.

The product's central promise, already recorded in `CLAUDE.md`, is:

> **Approval is the terminus.** Nothing claims ShipASO pushes to a store on its
> own.

The `runs` status enum (`schema.sql`) is described as the spine of that
guarantee, and `POST /runs/:id/approve` is commented "the human gate".

**The problem WebMCP creates:** a browser agent runs *in the page*, with the
user's own session. Declining to declare an approve tool does not remove the
capability — it only declines to advertise it. A scripted `fetch` from that
same page carries the same cookie and can POST the same endpoint.

So "only a human approves" was a claim about our tool manifest, not a property
of the system. That distinction is not academic here. WebMCP's own
security-privacy questionnaire notes that a page-declared `readOnlyHint` "may
cause the agent to skip a confirmation step" — page-declared tool semantics get
trusted by the agent reading them. A boundary that exists only in a manifest is
a boundary that the standard itself warns you not to trust.

Two further facts made the decision urgent rather than theoretical:

1. **The existing "read/draft only" tier was documentary.** `requireUser`
   comments that a scoped `shipaso_…` API key "can only reach read/draft
   tools", but `resolveApiKey` returns the same `{id, email}` shape as a cookie
   session. Once auth resolved, an API key was indistinguishable from a signed-in
   human. It could already approve. Nothing enforced the comment.

2. **`proposal_edits` would silently record agent decisions as human ones.**
   That table's entire value is capturing (agent proposal → human final,
   decision) as a genuine preference signal. If an agent could approve, or could
   author the final text of an approval, the table would keep recording rows
   that look like human judgment and are not.

## Decision

**Approval requires a nonce that only a trusted user gesture can mint.**

1. `POST /runs/:id/approve` requires an `x-approval-nonce` header. The nonce is
   minted by `POST /runs/:id/approval-nonce`. Scripted `fetch` cannot forge a
   trusted event, so a client that mints only from a real gesture cannot be
   driven into approving by an agent sharing its session.

   **The client contract:** the approve UI MUST call the mint route only from a
   handler where `event.isTrusted === true`, and MUST NOT expose a mint helper
   an in-page script could call directly. The server cannot verify that a
   gesture occurred — it can only ensure a nonce was obtained and is valid for
   this run and user. This half of the boundary lives in the client and is
   stated here because it is the half a future refactor could quietly break.
   (As of this ADR the approve UI is not yet built; the server side is.)

2. The nonce reuses the existing magic-link/session token construction —
   HMAC-SHA256 over a base64url JSON payload — with two additions:
   - kind tag `"approve"`, so a session token cannot be spent as a nonce and a
     nonce cannot be replayed as a session (both directions are tested);
   - a **signed subject** carrying the run id, so a nonce minted for run A is
     invalid on run B.

   It is additionally bound to the approving user's email. TTL is 60 seconds.

3. **`POST /runs/approve-all` accepts cookie sessions only.** It is deliberately
   exempt from the per-run nonce — it is a live dashboard ergonomic and
   demanding a trusted gesture per run would defeat its purpose. But without a
   restriction it would simply *be the way around the nonce*, so Bearer
   credentials and the demo-env `x-user-email` header are refused there.
   `requireUser` now reports **how** a caller authenticated (`cookie` |
   `bearer` | `demo-header`) to make that decidable.

4. **Rejection is not gated.** Rejecting closes the gate without shipping
   anything, so an agent clearing bad proposals is legitimate pre-gate triage
   and stays available to it.

5. **`proposal_edits.source`** records whether the final text came from the
   human or from an agent's draft, so an agent-drafted approval can never be
   counted as unedited human assent.

## Consequences

### What becomes true

No agent-held credential can cross the approval gate by either route. The
guarantee is a property of the server, testable and tested, rather than a
promise about what we chose to expose. Notably this now holds for the hosted MCP
at `api.shipaso.com/mcp` too — the gap in (1) above is closed by the same
mechanism.

### What it costs

**Programmatic approval is gone.** No CI job, script, or coding agent can
approve a run through the API. That is a real capability removed from a paid
product, and it forecloses "approve from your IDE" unless this ADR is revisited.
We accept it because it is the same sentence as the product promise: approving
is a human act.

No client used that capability at the time of this decision — the hosted MCP
exposes twelve tools and none of them approve — so nothing broke.

### What this does NOT claim

**The nonce is not single-use.** A stateless token is replayable inside its
60-second TTL. We did not add a nonce store, because the domain already closes
this: `approvals` is `UNIQUE (run_id)` and `decideRun` returns 409 on an
existing decision, so a replay hits an idempotency wall that predates this
change. Stated here so nobody later reads "nonce" as "single-use" and builds on
that assumption.

**`approve-all` remains coarser than the per-run gate.** One cookie-authenticated
click approves everything at the gate. It is a human gesture from a browser, but
it is one gesture for N decisions. That is an accepted product ergonomic, not an
oversight.

**A compromised browser session is out of scope.** This boundary separates
*agents from humans*, not attackers from users. Anything that can synthesize a
trusted user gesture in the page — a malicious extension, an XSS — defeats it,
as it would defeat any in-page control.

## Alternatives considered

**A. Accept the situation; claim only "no WebMCP tool approves."** True, modest,
and honest about the manifest. Rejected because the entry's whole thesis is the
boundary, and the strongest form of that claim cannot rest on what we declined to
advertise. One of the judges built MCP-B; this question gets asked.

**B(i). Require the nonce only when a WebMCP-session marker is present.**
Additive, changes nothing existing. Rejected as *worse than doing nothing*: the
bypass is removing the marker, and a scripted fetch controls its own headers. It
would pass for compliant clients and wave through non-compliant ones — precisely
the failure mode of trusting `readOnlyHint`, dressed up as a control.

**C. Gate rejection as well as approval.** Rejected: it would block an agent
from clearing bad proposals, which is legitimate pre-gate work, and it buys no
safety since rejection ships nothing.

**D. Store nonces in D1 for true single-use.** Rejected as unnecessary given the
`UNIQUE (run_id)` idempotency wall, and as a per-approval write on a hot path
for a property we already have.

## Revisiting

This ADR is scoped to the read-and-draft boundary as shipped for the WebMCP
entry. A later decision to let users **delegate** approval authority to an agent
would supersede parts of it. Note that the nonce becomes *useful* rather than
obstructive in that world: it is the mechanism that distinguishes a delegated
agent approval from a human one, which `proposal_edits.source` must record
separately for the preference signal to stay honest.

## Implementation

- `cloud/src/auth.ts` — `mintApprovalNonce` / `verifyApprovalNonce`
- `cloud/src/api/approvalBoundary.ts` — `requireApprovalNonce` /
  `requireHumanSession`
- `cloud/src/api/index.ts` — `AuthMethod`, both gates, the mint route
- `cloud/migrations/0013_run_ready_email_and_edit_source.sql` —
  `proposal_edits.source`

Tests: `auth.spec.ts` (crypto, both replay directions), `approvalBoundary.spec.ts`
(policy), `approvalBoundary.integration.spec.ts` (real Requests through
`handleApi`, so a correct-but-unwired policy fails).
