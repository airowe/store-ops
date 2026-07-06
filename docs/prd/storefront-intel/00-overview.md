# Storefront intel — consumers for the public listing read

> One public page fetch already shipped (`cloud/src/engine/storefrontListing.ts`,
> commits `e41d600` → `c60c989` → `88cb191`): every run now reads the app's own
> App Store product page and persists the intel as `audit.storefront`
> (`StorefrontIntel`) in `runs.reasoning_json`. This suite spends those fields.
> **Zero new page fetches anywhere below** — five PRDs, one seam, all consumers.

## The strategic frame (why this, why now)

- The seam just landed and most of its fields are dormant. `subtitle` reaches
  keyless runs and `shots` backstops screenshot grading (#41); `ratings`,
  `similarApps`, `languages`, `privacyLabels`, `inAppPurchases`, `whatsNew`,
  and `moreByDeveloper` are extracted, persisted — and read by nothing.
- This is data intelligence platforms (AppKittie-class, AppFigures, AppTweak)
  scrape at scale and charge for. We get it once per audit at zero marginal
  cost, on the page Apple serves anyone.
- Every PRD lands in surfaces that already exist (the findings card, the
  expansion card, competitor suggestions, the run trace) — no new value
  surface to invent, no UI redesign. That keeps the whole suite inside the
  "no fluff" bar for Phase 1.

## The map: field → consumer

| `StorefrontListing` field | PRD | Turns into |
|---|---|---|
| `ratings{average,count,histogram}` | [`01-ratings-histogram.md`](./01-ratings-histogram.md) | `ratingsSignal` (pure) + `ratings_polarized` / `ratings_thin` findings |
| `similarApps[]` (+ competitor `subtitle`) | [`02-similar-apps-discovery.md`](./02-similar-apps-discovery.md) | second discovery source (`apple_similar`) + real subtitles into `findKeywordGaps` |
| `languages[]`, `category` | [`03-languages-coverage.md`](./03-languages-coverage.md) | measured localization coverage + expansion card for **keyless** runs; `language_single` finding |
| `privacyLabels[]`, `inAppPurchases[]`, `whatsNew` | [`04-listing-findings-pack.md`](./04-listing-findings-pack.md) | privacy / IAP / release findings via the existing engine |
| `moreByDeveloper[]` | [`05-portfolio-detection.md`](./05-portfolio-detection.md) | `GET /apps/:id/portfolio` — "found N other apps by this seller — track them?" |

`subtitle` and `shots` are already consumed by the shipped seam work; they need
no PRD here.

## Recommended build order

**04 → 01 → 03 → 02 → 05**, sequenced by cost-to-value and coupling:

1. **04 — listing findings pack.** Cheapest possible consumer: three pure
   emitters into `auditFindings()`, no new module surface area, no schema, no
   routes. Proves the seam pays off in the product's main value surface first.
2. **01 — ratings histogram.** Same findings lane plus one small pure module.
   Do it right after 04 because the two PRDs specify the storefront wiring into
   `auditFindings` differently (01 adds `storefront?` to `AuditFindingsInput`;
   04 reads `input.audit.storefront` with no input change) — **land that wiring
   decision once, in whichever ships first, and the other conforms.**
3. **03 — languages coverage.** The funnel play: keyless users (the entire top
   of the funnel) get their first localization signal, feeding the localization
   flow's entry point. Highest strategic leverage per README Phase 0→1 bias.
4. **02 — similar-apps discovery.** Highest compounding value (the subtitle →
   `findKeywordGaps` unlock is structurally unavailable to lookup-only tools)
   but the most moving parts: a D1 CHECK-constraint table rebuild, per-call
   iTunes lookups, endpoint changes. Ship it once the pure-read PRDs are green.
5. **05 — portfolio detection.** Small and self-contained, but it serves the
   Phase-3 expand motion and its dashboard card is a fast-follow anyway
   (cloud/web undeployed) — nothing upstream waits on it.

## Honesty rules shared by the whole suite

Each PRD carries its own verbatim rules; these are the invariants they share:

- **Absent field = unknown = silence.** An unread page or a drifted shelf
  degrades that field's consumer — never the run, never a zero, never an empty
  array masquerading as "none" (`histogram: []` is *unreadable*;
  `moreByDeveloper` absent is `known: false`, not "no other apps").
- **Page reads are quoted verbatim and labeled with their source** — Apple's
  numbers as Apple's numbers, page-read-time values as page-read-time values,
  language-level data never dressed up as locale-level.
- **Suggestion ≠ action.** Discovered competitors and portfolio apps stay
  `suggested` until the human confirms; nothing is auto-watched or auto-tracked.
- **Severity respects the source.** Public-page findings cap at `warn`
  (never `critical`) — the #41 over-assertion guard.

## Cross-references

- [`../visual-assets/`](../visual-assets/00-overview.md) — the `shots` field is
  this seam's already-shipped consumer (screenshot grading, the #41 fallback);
  visual-assets is the *fix* lane for what those findings diagnose, and
  **#153** (ShipShots: LLM-planned, deterministically-rendered screenshot
  generation) is its Phase-B generation direction.
- [`../localization/`](../localization/00-implementation-plan.md) — PRD 03 is
  the keyless on-ramp into that flow: the expansion card it creates is the
  entry point for localization Phase 4's "Generate draft" (**#78** direction 1,
  per-locale metadata generation).
- **#95** (review sentiment + topics, shipped) — PRD 01's counterpart sample:
  the RSS-based read sees recent *written* reviews; the histogram is Apple's
  distribution over the whole ratings base. Complementary, never blended.
- **#154** (Custom Product Pages: audit coverage + per-intent CPP sets) — a
  future consumer of the same public-page discipline: CPP work grades and
  generates conversion surfaces the way this suite reads the default one.
  Nothing here blocks or is blocked by it.
