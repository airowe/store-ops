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
of the system. That distinction is not academic, and the standard itself says
so in three places:

- A page-declared `readOnlyHint` "may cause the agent to skip a confirmation
  step" (security-privacy questionnaire) — page-declared tool semantics get
  *trusted* by the agent reading them.
- `SubmitEvent.agentInvoked` (added March 2026) is the one automatic,
  browser-set signal that an agent acted. The guidance shipped with it is
  explicit: use it for "analytics, abuse detection, or to adjust UX — **do not
  use it for authorization**; that's the user's session, not the agent's."
  It is a signal, not a credential.
- Agent identity has no mechanism at all. `webmcp` issue #105 ("Agent Identity
  Verification and Authorization Framework", opened Feb 2026, still **backlog**)
  states that tools "cannot determine who is calling them" and that
  `requestUserInteraction` is "merely a polite suggestion agents can ignore".

In other words: the platform offers no way to know *who* is acting, and
explicitly warns against authorizing on the one signal it does offer. A boundary
built on caller identity is a boundary the standard tells you not to build.

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

**Approval requires a single-use challenge issued with the run view.**

> **Superseded design, kept because the failure is instructive.** This ADR
> originally specified a nonce minted from `POST /runs/:id/approval-nonce`,
> obtainable only from a trusted gesture. That property was never true.
> Measured against production in Chrome 151: a plain scripted `fetch` carrying
> the user's own cookie received a valid nonce, HTTP 200. The route's entire
> job was vending approval credentials, and it could not tell an agent from a
> person because both present the same session.
>
> A second attempt gated that route on `Sec-Fetch-Site`/`Sec-Fetch-Mode`,
> which are forbidden headers script cannot forge. That distinguishes our page
> from another *site* — but the threat is script running *inside* our page,
> which is same-site by definition. It defended the wrong boundary and was
> also measured failing in production.
>
> Both attempts passed their own test suites. Neither suite ever wrote down the
> attack, so neither could fail on it. That is the lesson worth keeping: a test
> asserting that a design behaves as designed is not a negative control.

1. `POST /runs/:id/approve` requires an `x-approval-challenge` header. The
   challenge is a 128-bit opaque value issued by `GET /runs/:id` for a run
   awaiting approval, recorded in `approval_challenges`, and **spent exactly
   once**. There is deliberately **no endpoint that issues one on request**.

   `consumeApprovalChallenge` marks the row in the same `UPDATE` that checks
   it (`spent_at IS NULL` in the `WHERE`), so a replay — or two approvals
   racing — matches no rows the second time. The database arbitrates, not a
   signature check with no memory.

2. **What this does NOT do, stated plainly.** It does not prove a human
   clicked. An agent in the page can read `GET /runs/:id` and therefore the
   challenge, exactly as the dashboard does. **No server-side check can
   distinguish them**, because `isTrusted` is a browser-side fact about a DOM
   event that never crosses the network, and any header purporting to carry it
   could be set by the same script we are defending against.

   What it removes is real but narrower than the original claim:
   - the credential-vending endpoint, which handed approval capability to any
     caller that asked;
   - unlimited re-minting — a challenge is one-shot;
   - replay of a captured value;
   - approval by a caller that never opened the run.

   **The client contract still stands and is still only a client contract:**
   `cloud/web/src/webmcp/trustedApprove.ts` is the single caller, it compares
   `isTrusted === true` (never a truthy coercion, since `{isTrusted: "true"}`
   is precisely what a caller synthesises), and RunView's approve button is its
   only caller. That is the honest client. It is not enforcement, and this ADR
   no longer implies otherwise.

   **Measured, not assumed.** In jsdom, `fireEvent.click()` and
   `element.click()` both produce `isTrusted === false`; in real Chromium,
   Playwright's `.click()` produces `true` while a `click()` from page script
   produces `false`. An agent driving the real page over CDP *can* produce a
   trusted click and approve. That limit is inherent to any in-page gate and is
   recorded here rather than papered over.

   A consequence worth stating: because no synthetic event can be trusted,
   component tests cannot drive approval through a real click. RunView accepts
   an injected `trustGesture` used ONLY by tests. Production omits it.

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

**It does not prove a human clicked.** The challenge is readable by anything
that can read the run view, an in-page agent included. Single use, run binding
and user binding are what it does guarantee. See the Decision section: no
server-side check can establish a gesture, and this document previously claimed
otherwise for two iterations.

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

**B(ii). Gate on `SubmitEvent.agentInvoked`.** The browser sets it, so unlike a
header it cannot simply be spoofed by the caller — which makes it the most
tempting wrong answer. Rejected because it is per-*event* and form-scoped: it
says nothing about a `fetch()` that never touches a form, and the spec's own
guidance forbids authorizing on it. Adopted for the opposite purpose instead —
see "Detection versus evidence".

**B(iii). Detect the agent some other way** (`navigator.webdriver`, UA sniffing,
behavioural heuristics, CDP probing). Rejected: `webdriver` detects automation
frameworks, not an in-page agent; UA and headers are self-declared; heuristics
false-positive on fast, keyboard-driven, and assistive-technology users, which
makes them an accessibility hazard as well as unreliable.

**C. Gate rejection as well as approval.** Rejected: it would block an agent
from clearing bad proposals, which is legitimate pre-gate work, and it buys no
safety since rejection ships nothing.

**D. Store nonces in D1 for true single-use.** Originally rejected as
unnecessary given the `UNIQUE (run_id)` idempotency wall, and as a per-approval
write on a hot path. **This rejection was wrong and is now the accepted
design.** The idempotency wall stops a run being approved twice; it does nothing
about the credential being obtainable at all, which was the actual hole. The
write is one row per run view, which is not a hot path.

## Detection versus evidence

The rejected alternatives share one mistake: they ask **"who is calling?"** The
agent runs in the page, as the user, with the user's session — at the HTTP and
DOM layer there is no boundary between them to detect across. The platform
confirms this (issue #105) rather than merely failing to help.

The design instead asks **"was this challenge issued to this user for this run,
and is it still unspent?"** That is answerable server-side and fails safe. The
older framing — "did a human gesture happen?" — is not answerable server-side at
all, and treating `isTrusted` as though it were is what produced two failed
iterations of this ADR.

The signals that *do* exist are used where being wrong is harmless:

- **`agentInvoked` and tool-call events** drive the UI — the always-visible
  tools panel lights up the tool an agent just called, so the human watching
  sees the work happen. Both only ever fire *truthfully positive*; neither can
  assert an absence, and neither grants anything.
- **Structured refusals.** A refused approval returns a stable
  `boundary: "human-approval-required"` code plus `youCan` (the read-and-draft
  capabilities still open) and `humanMustDo`. A human never sees this body — the
  UI renders its own message — so it exists purely so a caller that hit the
  endpoint directly gets a handoff instead of a bare 403. A test asserts no
  `youCan` entry can cross the gate, so the list cannot drift into granting.
- **A `Link: rel="webmcp"` header** on API responses, advertising the page
  surface to a programmatic caller that would otherwise never discover it.

**The rule that keeps all of this safe:** a caller's self-description may change
what we *tell* them, never what we *permit*.

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
