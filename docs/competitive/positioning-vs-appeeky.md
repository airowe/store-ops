# Positioning: ShipASO vs Appeeky

**Captured:** 2026-06-21
**Companion docs:** `appeeky.md` (the competitor breakdown), `appsprint.md` (the
other direct competitor), `aso-is-back-wwdc26.md` (the LLM-ranking thesis).
**Grounding:** every ShipASO claim below is tied to shipped code in this repo. The
load-bearing files are `cloud/src/engine/rankAttribution.ts`,
`cloud/src/engine/keywordReasoner.ts`, `cloud/src/api/proposalEdit.ts`,
`cloud/src/engine/preferenceSignal.ts` + `cloud/src/d1.ts` (captureProposalEdits),
and the landing page `docs/landing/index.html`.

---

## 0. The honest starting point

Appeeky is the most direct competitor we've seen. It uses our exact word
("agentic"), names our exact features (keyword gaps → "winnable terms", scored
findings → "prioritized recommendations", war room → "side-by-side score
comparisons"), and **beats us on every breadth axis**: iOS + Android (we're
iOS-only), desktop + mobile + web (we're web-only), daily rank snapshots (we run
weekly cron), volume/difficulty/opportunity *numbers* across countries (we
deliberately don't fabricate them), an MCP server, review sentiment, and price
($8/$20/$66 vs our $19/$149 recurring).

**We cannot win on "more features," "more data," "more platforms," or "cheaper."**
Positioning has to be a genuine wedge or it's noise. The good news: Appeeky's
entire listed surface is *analysis and recommendation* — audits, scores, copilot
advice. Nothing in their material describes closing the loop: draft the change,
gate it on a human, push it, and prove the rank moved. That is the one thing
ShipASO is *architecturally* built around, and it's where we plant the flag.

---

## 1. One-sentence positioning statement

> **Appeeky tells you what to change; ShipASO ships the change you approve and then
> proves — honestly — whether the rank actually moved.** It's the difference
> between an ASO *advisor* and an ASO *operator that keeps the receipts.*

Short form for a headline: **"Advice is cheap. We close the loop and prove it."**

---

## 2. The wedge, defended

Three candidate wedges. They are not equal. Ranked by defensibility:

### Wedge A — The closed push-and-PROVE loop  ★ MOST DEFENSIBLE

**The claim:** ShipASO is the only one of the two that runs
`prepare → human-approves → push → prove the rank moved`, and proves it with a
discipline a competitor can't fake by bolting on a number.

**Proof (real, in-repo):**
- `cloud/src/engine/rankAttribution.ts` is the literal codification. It JOINs
  `rank_snapshots` (what moved) to the approval log (what was pushed and which
  terms it *added*) **on time**, and labels every movement `linked`,
  `coincident`, or `none`. It refuses causal language by design — a test scans
  every emitted string and rejects "caused/because/drove/led to/due to"; the copy
  is always "*after* you added 'x' to keywords (Jun 12)." That is proof you can
  trust *because* it under-claims.
- The approval gate is enforced in code, not in copy: `cloud/src/api/proposalEdit.ts`
  merges only the fields the agent actually proposed, then re-runs the engine's
  authoritative `validateCopy` server-side — "an over-limit or keyword-rule-
  violating edit can never be staged for push." The README/landing line "the
  approval gate is in code; nothing ships until you say so" is true at the handler.
- The landing page already sells this exact shape: the six-step loop terminates in
  `verify — rank read back over time ✓`, and the public proof strip
  (`docs/landing/index.html`, `/proof` endpoint) **stays hidden until there are
  real wins** — we refuse to manufacture social proof.

**Risk (how Appeeky neutralizes it):** Appeeky already has "daily rank snapshots"
and ASC sync. They are *one feature away* — a "what changed since your last push"
view — from claiming a loop. If they ship attribution, our edge collapses to
*quality of attribution* (our honesty discipline vs their confident arrow), which
is a subtler sell. **This wedge is defensible today but has the shortest fuse.**
We should treat "make the proof undeniable" (§6) as urgent, not leisurely.

### Wedge B — Honesty / never-fabricate + intent-grounded keywords  ★ REAL BUT NARROWING

**The claim:** Appeeky shows volume/difficulty/opportunity *numbers* and download
*estimates*. ShipASO never presents unmeasured data as measured, and derives
keyword targets from the app's real description, not name tokens or a vendor's
estimate.

**Proof (real, in-repo):**
- `cloud/src/engine/keywordReasoner.ts` — "LLM classifies, reality validates." It
  guardrails the model against the grounding text so it "can never invent a keyword
  or promote the brand word to a target," and degrades to a deterministic classifier
  on garbage. The worked example (Mangia: drop "mangia"/"manager", target the real
  intent) is exactly the failure mode estimate-driven tools fall into.
- We deliberately ship "unmeasured" where a number would be a guess (the #78 ASA-
  data gap), and the attribution module's `coincident` label exists *specifically*
  to avoid taking credit we didn't earn.

**Risk (how Appeeky neutralizes it):** This is the weaker wedge as a *standalone*
sell, and the appeeky.md assessment is right to flag it. Against a vaguer
competitor, "we're honest about what we didn't measure" lands. Against a tool that
shows a buyer a confident volume number, "we show you 'unmeasured'" reads as *we
have less data* unless the buyer has been burned by a wrong number. Honesty is an
invisible discipline; Appeeky's number is a visible feature. **We must make honesty
*visible* (§6) or it loses the demo.** Its strength is almost entirely contingent
on the WWDC-2026 thesis (§5).

### Wedge C — Learning-from-human-edits loop (#39 Part 2)  ★ WEAKEST / NOT YET A SELLING POINT

**The claim:** ShipASO captures how humans edit its proposals and improves from it;
Appeeky's copilot has no stated mechanism that learns from edits.

**Proof (real, but partial):** The *capture* half ships and is genuinely well-built —
`cloud/src/engine/preferenceSignal.ts` builds per-field (proposed → final) diffs,
and `captureProposalEdits` in `cloud/src/d1.ts` writes them **anonymous** (no
user_id/app_id), **encrypted** (AES-256-GCM), and **opt-out by default-on**.

**Why it's the weakest wedge today — be blunt:** the capture **safe-degrades to
writing zero rows when `RLHF_ENCRYPTION_KEY` is unset** (see the `if (!key) return
[]` guard in `captureProposalEdits`), and there is **no training/serving side at
all** — nothing consumes the captured signal to improve the composer. So the
honest status is: *plumbing shipped, learning dormant.* **Do not market this as a
live capability.** It is a roadmap differentiator and a privacy-architecture story,
not a product claim. Claiming "it learns from you" today would be vaporware.

**Risk:** Even fully activated, "it learns from edits" is hard to *demonstrate* to a
buyer in a demo, and Appeeky could claim the same words without us being able to
disprove it. Low marketing leverage relative to engineering cost.

**Verdict:** Lead with **A**, reinforce with **B** (especially post-WWDC), and keep
**C** out of the headline until the secret is set and there's a visible improvement
to point at.

---

## 3. Messaging angles (true to what ships)

Each is grounded; the one that touches unshipped work is flagged.

1. **"Advice is cheap. We close the loop."**
   Every ASO tool — Appeeky included — stops at the recommendation. ShipASO drafts
   the metadata, you approve it, it ships, and it reads your rank back over time.
   *(True: the six-step loop + `rankAttribution.ts`.)*

2. **"We prove the rank moved — and we tell you when we *didn't* move it."**
   Our rank attribution links a move to your push only when your push actually
   *added* that term, and calls everything else "coincident." Honest proof beats a
   confident arrow you can't trust. *(True: `rankAttribution.ts` `linked`/
   `coincident` + the no-causal-language test.)*

3. **"The approval gate is in the code, not the marketing."**
   Nothing ships until you approve, and the server re-validates every edit against
   the real character limits and keyword rules — an invalid change physically can't
   be staged. *(True: `proposalEdit.ts` + server-side `validateCopy`.)*

4. **"Keywords from your app, not a vendor's estimate."**
   We derive targets from your actual description and guardrail the model so it
   can't invent a term or target your brand word. We'd rather show "unmeasured"
   than sell you a made-up volume number. *(True: `keywordReasoner.ts` + the #78
   no-fabrication discipline.)*

5. **"Your edits stay yours."**  ⚠️ *Depends partly on unshipped work — frame as
   privacy architecture, not as a live learning feature.*
   When you correct a proposal, the diff is captured anonymous, encrypted, and
   opt-out — never tied to your app, never resold. *(Capture is real; the
   "it learns from this" payoff is dormant pending `RLHF_ENCRYPTION_KEY` and a
   training/serving path. Say "your edits are private," **not** "the agent learns
   from you," until that's live.)*

---

## 4. What NOT to claim

- **Don't claim more/fresher data.** Appeeky has daily snapshots and
  volume/difficulty/opportunity numbers across countries; we run weekly cron and
  deliberately show "unmeasured." We lose that comparison at face value. Never
  imply our data is broader or fresher.
- **Don't claim more platforms or surfaces.** They have iOS **and** Android,
  desktop + mobile + web, Home Screen widgets, and an MCP server. We're web-only,
  iOS-first. Don't get drawn into a surface-count fight.
- **Don't claim cheaper.** Their $8 Indie / $20 Startup / $66 tiers undercut our
  $19/$149 recurring. Price is their weapon, not ours; compete on outcome.
- **Don't claim review sentiment / topic analytics.** We don't have that surface.
- **Don't claim "the agent learns from your edits" (yet).** Capture ships; learning
  is dormant. This would be the most damaging dishonest claim because it's exactly
  the kind of thing our own honesty positioning would be hypocritical to fake.
- **Don't assert the WWDC-2026 "Apple LLM-ranks now" mechanism as fact.** Both
  source authors hedge it; our own data could neither confirm nor refute it. Design
  *toward* it; never state it as measured truth in user-facing copy (this is the
  same discipline that *is* our wedge — breaking it here would be self-defeating).
- **Don't over-claim week-over-week movement.** If ranks really shift annually at
  WWDC and hold ~11 months, our weekly deltas may be mostly flat; "prove the rank
  moved" must not imply constant motion.

---

## 5. Where the WWDC-2026 LLM-ranking thesis changes the calculus

If Apple is now running an LLM over rankings to sort "real apps" from slop, the
game shifts from *keyword-volume optimization* to *convincing the model your app is
legitimately the real deal*. That has two effects:

- **Wedge B (honesty / intent-grounding) strengthens sharply.** A model-gated store
  devalues the confident volume number that is Appeeky's most visible advantage,
  and rewards keywords genuinely grounded in what the app *is* — which is precisely
  what `keywordReasoner.ts` produces ("strictly derived from the description"). In
  that world, "we don't fabricate volume" flips from a liability ("they have fewer
  numbers") to the point ("those numbers stopped mattering"). This is the scenario
  that makes our weaker wedge our strongest.
- **Wedge A (prove the rank moved) gets a tailwind too** but for a different reason:
  the market just *un-stuck* (a year of dead rankings → "the needle finally moved"),
  and a rank-proving product is only compelling when ranks demonstrably move. A
  proof loop is far more sellable in mid-2026 than it was during the frozen year.

**Net:** if the thesis holds, lead with A *and* B together — "we target what the
model actually rewards, then prove it moved." If it doesn't hold and volume numbers
still rule, A carries the positioning alone and B retreats to a supporting honesty
note. Either way A is the spine; the thesis only changes how much weight B can bear.

---

## 6. Two-to-three product bets that WIDEN the wedge

All three are grounded in the current architecture and aimed at making the most
defensible wedge (A) *undeniable* and the honesty wedge (B) *visible*.

1. **Ship a shareable, dated before/after "proof card" as the headline artifact.**
   We already render a share card (`shareCard.ts`, `pickShareWin`) and have the
   honest attribution (`rankAttribution.ts`). Turn the `linked` movements into a
   public, link-shareable "Jun 4 → Jun 18: 'stoic without religion' #84 → #31,
   after you added 'stoic'" card with the `coincident` ones honestly labeled.
   This makes "we prove it" a *thing the buyer can hold and tweet*, not a claim —
   and the honesty (the coincident labels) becomes the credibility, not a caveat.
   Widens A directly and makes B visible in the same artifact. Highest leverage.

2. **Make honesty a visible, in-product comparison: an "unmeasured vs estimated"
   stance the buyer sees.** Where Appeeky shows a confident volume number, show our
   honest proxy *next to* an explicit "we didn't measure this; here's what we did"
   line — and on the attribution view, surface the `coincident` count as a feature
   ("3 moves we will NOT take credit for"). This converts honesty from an invisible
   engineering discipline into a demoable differentiator, which is the only way
   Wedge B survives contact with a confident competitor.

3. **Tighten and *time-stamp* the loop so attribution is causally tighter than a
   daily snapshot can fake.** Appeeky's daily snapshots are their path to claiming a
   loop; our defense is that *we know exactly which terms each approved push added
   and when* (the approval log + `addedTermsOf`). Bet: record the push timestamp and
   added-terms with enough fidelity that we can show a tight pre/post window per
   keyword — proof a tool that only diffs daily rank tables structurally can't
   match, because it doesn't own the change event. This is the moat-deepening move
   if Appeeky tries to bolt attribution on.

> (Activating the RLHF training loop — set `RLHF_ENCRYPTION_KEY`, build the
> serving side — is a real bet too, but it's a *future* wedge with low demo leverage
> and is explicitly out of the headline until live. List it on the roadmap, not the
> homepage.)

---

## Bottom line

Appeeky out-features, out-platforms, out-prices, and out-data us, and we should
stop pretending otherwise. The one thing they describe nowhere — and the one thing
our codebase is actually built around — is the **closed, human-gated, honestly-
proven push loop.** That is the wedge. Honesty/intent-grounding is the reinforcement
that becomes decisive *if* the model-ranking thesis holds. The learning-from-edits
loop is dormant plumbing, not a claim. Win by being the operator that keeps honest
receipts, not the advisor with the biggest dashboard.
