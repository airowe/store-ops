# PRD 04 — Volume / difficulty / opportunity — the HONEST version

**Status:** Proposed — **read the Non-goals before building**
**Priority:** P2 (do LAST; highest honesty risk of any PRD here)
**Closes gap:** Appeeky shows "volume, difficulty, opportunity scoring" numbers
across countries. We deliberately show "unmeasured" (#78) because we don't
fabricate ASA-style numbers we can't measure.

---

## ⚠️ The core tension

This is the gap that directly collides with the product's identity. Our wedge is
**honesty: never present unmeasured data as measured.** Appeeky shows confident
volume/difficulty numbers. To a buyer who just wants a number, they win that
comparison at face value (per `appeeky.md`).

There are only two *honest* ways to close this gap. **A fabricated number is not
one of them** and is an explicit, hard non-goal.

## Goals (pick a path; both are honest)

**Path A — Source real data.** Integrate a real keyword-data source (Apple Search
Ads API for the user's own keyed account, or a licensed third-party dataset).
Where we have a real measured number, show it. Where we don't, keep showing
"unmeasured." Provenance is always labeled.

**Path B — Honest derived signal.** Compute an *opportunity* signal from data we
*do* measure honestly — real rank positions (`rankOpportunity.ts` already exists),
real competitor overlap (`keywordGap.ts`), title/coverage gaps — and present it as
a **derived, labeled** score: "opportunity (derived from rank + competition), not
a measured search volume." This is the difference between a confident number and a
*defensible* one.

Recommended: **ship Path B first** (we can do it honestly today), offer Path A as a
keyed/paid enhancement for users who connect ASA.

## Non-goals (hard limits — these are the product's identity)

- **NEVER fabricate or estimate-as-fact a search-volume or difficulty number** to
  match Appeeky's display. No invented numbers, no unlabeled estimates, no
  "looks-like-a-number" UI for data we didn't measure. This violates #78 and the
  product's core promise.
- Do not relabel a derived signal as "search volume." A derived opportunity score
  must be labeled as derived, with its inputs stated.
- Do not silently extrapolate one country's data to others.

## Proposed design (Path B)

- New engine module `cloud/src/engine/keywordOpportunity.ts` (distinct from the
  existing `rankOpportunity.ts`): combine measured rank, measured competitor
  overlap, and title-space availability into a 0–100 opportunity score **with an
  explicit `inputs` array** naming every measured signal that fed it.
- UI: render the score next to a "how this is computed" affordance. Never a bare
  number with no provenance.
- For ASA (Path A), gate behind the user connecting their own ASA credentials;
  show measured volume only for their keyed account; everything else stays
  "unmeasured."

## Success criteria

- A keyword shows a derived opportunity score whose provenance (the measured
  inputs) is inspectable.
- No surface anywhere displays a fabricated volume/difficulty number.
- A test asserts that with no measured data source connected, the UI shows
  "unmeasured" / derived-only — never a fabricated figure.
- The WWDC-2026 thesis hedge: if Apple's LLM ranking makes raw volume matter
  *less* and intent matter *more*, Path B's derived-from-real-signal approach ages
  better than Appeeky's raw numbers anyway.

## Open questions

- Is ASA integration worth the keyed-onboarding friction pre-launch, or is Path B
  alone enough to neutralize the comparison?
- How prominent should the "derived, not measured" labeling be without making the
  feature feel weaker than a competitor's confident (but possibly fabricated)
  number?

## Rough size

**M** (Path B) / **L** (Path A with ASA integration).
