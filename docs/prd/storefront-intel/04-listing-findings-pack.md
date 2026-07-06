# PRD 04 — listing findings pack (privacy · IAP · release)

> The `audit.storefront` seam (commit `88cb191`) already carries privacy labels,
> IAP names+prices, and What's New text on every run — public-page data our
> competitors (AppFigures, AppTweak) charge for and most indie devs never look
> at. This PRD turns three of those fields into audit findings via the existing
> findings engine: zero new fetches, zero new endpoints, the cheapest possible
> consumer of intel we already persist. It ships now because the seam just
> landed and the findings card is already the product's main value surface.

## Where it attaches

`cloud/src/engine/auditFindings.ts` — three new per-surface emitters in the
established pattern (pure, deterministic, network-free), wired into the
`auditFindings()` spread. Data source is `input.audit.storefront`
(`StorefrontIntel`, `cloud/src/engine/agent.ts`) — **no `AuditFindingsInput`
change in v1**. Findings flow through the existing run path, persistence, and
run-page card untouched (asc-findings PRD 02/03). No new API routes.

## Deliverable

```ts
// auditFindings.ts — internal emitters, same shape as screenshotFindings etc.
function privacyFindings(input: AuditFindingsInput): Finding[]; // surface: "privacy"
function iapFindings(input: AuditFindingsInput): Finding[];     // surface: "iap"
function releaseFindings(input: AuditFindingsInput): Finding[]; // surface: "release"
```

### (a) Privacy labels — `storefront.privacyLabels`
- `privacy_data_not_collected` (good, trust) — labels are exactly
  `["DATA_NOT_COLLECTED"]`: a real conversion/trust differentiator; say so.
- `privacy_labels_observed` (info, trust) — labels present: list them as
  evidence so the user sees what shoppers see.
- Competitor privacy comparison is **deferred** (needs competitor storefront
  reads; sibling PRD territory). Named here so nobody bolts it on ad hoc.

### (b) IAP visibility — `storefront.inAppPurchases`
IAP display names are public on the product page and can surface in App Store
search — a free metadata surface most listings waste on "Premium Monthly".
- `iap_names_keyword_bearing` (good, ranking) — ≥1 IAP name contains a tracked
  keyword (`topKeywords(input.ranks, …)` — the run's real targets, never
  invented terms). Evidence: the matching name(s).
- `iap_names_generic` (info, ranking) — IAPs present but no name overlaps any
  tracked keyword. Fix copy: descriptive, keyword-bearing display names.
  Prices appear in evidence strings **only as observed facts** — never advice.

### (c) Release — `storefront.whatsNew`
- `whats_new_boilerplate` (info, conversion) — the text we actually captured is
  boilerplate ("bug fixes and performance improvements" class patterns, const
  list in the engine). Measured: we have the text; the judgment is about it.
- **Date-based staleness does NOT ship in v1.** Verified against the current
  extractor (`storefrontListing.ts`): we capture What's New *text only* — no
  release date, no version string; `externalVersionIdentifier` appears nowhere
  in `cloud/src`. "No update in a long time" is therefore not measurable from a
  single run today, so no finding may claim it. Two honest Phase-2 paths:
  1. Extend `extractStorefrontListing` **iff** a saved live-page fixture proves
     the serialized payload carries a release date / version identifier. If the
     field isn't there, this path dies — we don't approximate.
  2. Cross-run delta: persist a version identifier per run; when two stored
     runs ≥ N days apart show the same identifier, staleness is measured from
     **our own observation timestamps**. Engine stays pure: prior observation
     + current run time arrive as an optional input field
     (`storefrontHistory?: { versionId: string; observedAt: string }[]`),
     never `Date.now`.

## Honesty rules (this feature, verbatim)

- **Absent field = unknown = silence.** No `privacyLabels` ⇒ no privacy
  finding; no `inAppPurchases` ⇒ no IAP finding; no `whatsNew` ⇒ no release
  finding. Never "you have no privacy labels / no IAPs / no release notes" —
  extraction degrade is indistinguishable from genuine absence.
- **Never invent pricing advice.** IAP prices are quoted as evidence only;
  no finding suggests raising, lowering, or restructuring a price.
- **Never guess dates we don't have.** Staleness fires only from a
  page-provided date (Phase 2, fixture-verified) or two same-version
  observations with our own timestamps — never inferred from text tone.
- **Keyword claims only against tracked keywords** from `ranks` — never terms
  the run didn't target.
- **Severity caps at `warn`** (in practice info/good) — public-page reads,
  same over-assertion guard as pricing/age-rating (the #41 trap).

## Test plan (TDD — specs first, in `auditFindings.spec.ts`)

Table-driven, pure, zero HTTP. Per rule: fires on its triggering
`audit.storefront` fixture, stays silent otherwise. Plus:
- `audit.storefront` absent ⇒ all three emitters contribute nothing, no throw.
- Each field independently absent ⇒ only that family is silent (safe-degrade).
- `DATA_NOT_COLLECTED` alone ⇒ `privacy_data_not_collected`, not `_observed`.
- Keyword-bearing match is case-insensitive against tracked keywords; an IAP
  name matching an *untracked* term does not fire `iap_names_keyword_bearing`.
- No emitted finding's copy contains price advice verbs or any date claim
  (string-level invariant assertions on title/detail/fix).
- Determinism: same input twice ⇒ deep-equal arrays; sort integrates with
  existing `sortFindings` ordering.

## Non-goals

- Competitor privacy comparison (deferred, above).
- Date-based staleness in v1 (Phase 2, gated on fixture proof or run history).
- Any new fetch, extractor change, endpoint, or UI work — the existing
  findings card renders these rows as-is.
- Pricing strategy of any kind.

## Acceptance

- Three emitters wired into `auditFindings()`; all rules unit-tested
  (fire + stay-silent); honesty invariants asserted in tests.
- `npm run typecheck` + full vitest green from `cloud/`.

## Open questions

1. Does the storefront serialized payload carry a release date or
   `externalVersionIdentifier` at all? Phase 2 is gated on a saved fixture
   answering this — nobody claims measurability before it exists.
2. Boilerplate pattern list: which phrases, and do we only match English
   (storefront country currently drives page language)?
3. Cross-run staleness threshold (90 days?) and where the prior observation is
   loaded (runs-table query in the API path, passed in as input).
4. Should `iap_names_keyword_bearing` also consider the run's *proposed*
   keywords, or strictly tracked ranks?
