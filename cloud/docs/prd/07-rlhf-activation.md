# PRD 07 — Activate the learning-from-edits loop

**Status:** Proposed (gated on owner/governance decision)
**Priority:** P1 (turns dormant plumbing into a *real* differentiator; widens wedge)
**Closes gap:** Appeeky has an AI Copilot grounded in app data, but **no stated
mechanism that learns from human edits to its proposals.** We shipped the capture
plumbing (#39 Part 2) — it's dormant. Activating it (honestly) is a differentiator
Appeeky doesn't claim.

---

## Problem

#39 Part 2 already ships: anonymized, encrypted, opt-out-default edit capture
(`proposal_edits` table, `rlhfCrypto.ts`, `preferenceSignal.ts`). But it is
**dormant** — no `RLHF_ENCRYPTION_KEY` / `RLHF_EXPORT_TOKEN` set, and crucially
**nothing trains on the captured data.** The positioning doc is blunt: marketing
this today would be vaporware. Activation = making it real, then (only then) able
to claim it.

## Goals

1. Set the RLHF secrets (owner-only action) so capture goes live — gated on the
   anonymization/governance review being signed off.
2. Build the **consumption** side: turn captured proposal-edit signal into a
   measurable improvement in the composer's proposals.
3. Be able to make an *honest, evidenced* claim: "the composer's suggestions
   improve from real editor feedback" — backed by a before/after quality metric,
   not a slogan.

## Non-goals (the honesty fence)

- **Do NOT market "it learns from your edits" until step 2 demonstrably works.**
  Per `positioning-vs-appeeky.md`, claiming a dormant loop is vaporware and would
  hypocritically undercut honesty — our actual wedge. The claim follows the
  evidence, never precedes it.
- No de-anonymization. Rows stay anonymous-by-construction (no user_id/app_id),
  encrypted at rest, opt-out default-on. Activation must not weaken any of this.
- No training on a user's data when they've opted out (write-time gating already
  enforces this; verify it stays enforced).

## Proposed design

**Phase 1 — go live (capture):**
- Owner sets `RLHF_ENCRYPTION_KEY` + `RLHF_EXPORT_TOKEN` via `wrangler secret put`
  (never generated or entered by the agent — owner-only, per safety constraints).
- Confirm capture writes encrypted, anonymous rows and the export route stays
  fail-closed (403 without token) — already implemented; verify in prod.

**Phase 2 — consume (the actual differentiator):**
- A periodic export → offline analysis of `proposed_enc` vs `final_enc` deltas
  (decrypted only in the trusted analysis environment) to mine *patterns* in how
  editors change proposals (tone, length, keyword choices).
- Feed those patterns back as composer prompt/heuristic adjustments
  (`optimize.ts` / `keywordReasoner.ts`). Start with prompt-level adjustments
  (cheap, reversible), not model fine-tuning.
- Define a **before/after proposal-acceptance metric**: do post-adjustment
  proposals get edited *less* (higher first-pass acceptance)? That metric is the
  evidence that licenses the marketing claim.

## Success criteria

- Capture is live, verified anonymous + encrypted + opt-out-respecting in prod.
- A measurable improvement: post-adjustment proposals are edited less than a
  baseline (the honest evidence).
- Only after that: a defensible public claim about the learning loop.

## Open questions

- Governance sign-off on going live with capture (anonymization review).
- Prompt-adjustment vs. heavier ML — start with the cheap, reversible path.
- Volume: how many captured edits before the signal is meaningful? (Don't claim
  the loop works off a handful of rows — same sample-size honesty as PRD 03.)

## Rough size

**M** — Phase 1 is mostly verification of already-shipped code + an owner action.
Phase 2 (the part that matters) is the real work: export pipeline + pattern
analysis + the acceptance metric.
