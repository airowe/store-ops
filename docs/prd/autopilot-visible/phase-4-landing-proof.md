# Phase 4 — the landing page proof

Status: **planned**. Depends on Phase 2 existing to photograph, and on **#495
being deployed and observed working**.

## Problem

The landing hero currently reads:

> The ASO loop that ships your metadata and proves the rank moved.
> Other tools tell you what to do. ShipASO does the work — and reads the rank
> back to check it worked.

It is a claim with no evidence on the page, and "ships your metadata" sits
uncomfortably close to the line the product does not cross — approving is not
shipping, and a reader could reasonably infer we push on their behalf.

## Goal

Lead with autopilot, and prove it on the page with the real in-product surface
rather than an assertion.

## The hook

**"ASO on autopilot."**

Considered and rejected:

| Candidate | Why not |
|---|---|
| "Let our agents manage your ASO" | "Manage" overclaims. The agent proposes; the user approves and submits. Invites the same scrutiny that produced the App Review rejections. |
| "Robotic ASO" | Reads mechanical and dumb rather than autonomous. |
| "Agentic ASO" | Industry jargon. Legible on HN, invisible to an indie developer. |

"Autopilot" wins on a specific technicality that happens to be the honest one:
**everyone knows an autopilot still has a pilot.** It claims the automation
while implying the supervision, which is exactly the product's shape.

## The proof

A screenshot of the Phase 2 `LoopStatus` on a real account, showing real dated
history — 9 agent-opened checks since June — beside a short line stating what
the agent does and where it stops:

> Your agents watch your rankings, spot what moved, and prepare the fix.
> You approve. Submitting to the store stays yours.

The last sentence is not a disclaimer to be shrunk in review. It is the reason
the claim above it is safe to make.

## Constraints

- **Real data only.** A mocked screenshot showing invented sweep history on a
  page selling measurement honesty is self-refuting. Use the owner's account.
- **No fabricated metrics.** No "10,000 keywords tracked", no "used by N
  developers" (there are two real users). The dated run history is the only
  number on the page.
- **The hero must not imply we push.** Revisit "ships your metadata" in the
  same pass.

## Gate — do not ship this before the loop demonstrably works

Until #495 is deployed:

- the approval gate is jammed for every app (#492), and
- no real user can be notified when one opens (#494).

Advertising autopilot while the autopilot is stuck would be a false claim about
our own product, made on the page that sells our honesty about measurement.

**Ship condition:** #495 deployed, and at least one Monday sweep observed
opening gates and delivering notifications. Verify by querying `runs` for
`awaiting_approval` rows created by that sweep — not by assuming the deploy
implies the behavior.
