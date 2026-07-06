# PRD 03 — `languages[]` → measured localization coverage (storefront-intel)

Status: **proposed**. Depends on the landed seam (`audit.storefront: StorefrontIntel`,
commit `88cb191`) — the storefront page fetch already happens on every run; this
PRD spends one of its fields. Ties into `docs/prd/localization/` (#78 direction 1)
and the shipped expansion heuristic (`ranking-features/04-localization-expansion.md`).

## Strategic frame

Localization is our clearest expansion wedge (#78: TryAstro ships it at $9/mo;
the whole @kedytcom experiment is localization) — but today the expansion card
only appears on **keyed** runs, because `recommendLocales` needs `liveLocales`
from the ASC snapshot. Keyless users — the entire top of the funnel — get zero
localization signal even though the public storefront page we already fetch
lists the app's languages. This PRD makes coverage **measured** for keyless runs
and turns "EN-only" into a finding that routes users into the localization flow.

## What exists (verified)

- `extractStorefrontListing` reads `languages?: string[]` — display names,
  verbatim from the page's "Languages" shelf (e.g. `["English", "German"]`).
- `audit.storefront?.languages` carries it through the run + persist round-trip.
- `recommendLocales({liveLocales, category})` (pure) — keyed-only today, wired
  in `cloud/src/api/index.ts` (~line 1520) from `ascSnapshot.locales`.
- `locales-data.json` — every one of the 40 model locales has a `language`
  display name matching Apple's storefront strings ("English", "Simplified
  Chinese", …), so the name→codes mapping is derivable from the bundled model.
- `auditFindings` already receives `audit` and emits `locale_single`
  (keyed-only, `snapshot.locales.length === 1`).

## The granularity trap (drives the whole design)

Storefront `languages[]` is **language-level**; ASC locales are **locale-level**.
"English" on the page cannot tell us whether en-GB/en-AU metadata exists. So on
a storefront-sourced read we (a) label coverage as language-level, and (b)
exclude **every** locale of a listed language from recommendations — we would
rather miss a real es-MX opportunity than call a surface "unclaimed" when we
never measured it.

## Deliverable

New pure module `cloud/src/engine/languageCoverage.ts` (no bindings, no fetch):

```ts
export type LanguageCoverage = {
  source: "storefront";            // ASC-sourced coverage never uses this type
  languages: string[];             // measured, verbatim from the page
  coveredLocales: string[];        // model locales whose `language` is listed
  unmappedLanguages: string[];     // listed names the model doesn't know
};
export function coverageFromLanguages(languages: string[]): LanguageCoverage;

export function recommendLocalesFromLanguages(input: {
  languages: string[];             // audit.storefront.languages, verbatim
  category?: string | undefined;   // audit.storefront.category (also measured)
}): { recommendations: LocaleRecommendation[]; coverage: LanguageCoverage };
```

`recommendLocalesFromLanguages` reuses `rankAll`'s scoring, but excludes by
language (not code) and computes effort/saturation from the **language count**
(1 language → "translate", up-to-7 recs) — feeding 8 derived English codes into
`liveLocales` would falsely trigger the multi-locale saturation taper.

**Wiring** (API, keyless run path in `cloud/src/api/index.ts`): when the run has
no ASC snapshot and `result.audit.storefront?.languages` is present, attach
`result.localizationExpansion` + `result.languageCoverage`. The keyed path is
untouched — ASC's locale list stays authoritative and is never overridden.

**Finding** (`cloud/src/engine/auditFindings.ts`, rule reads
`input.audit.storefront?.languages`; fires only when `snapshot?.locales` is
absent, so it can never double up with `locale_single`):

- id `language_single`, surface `locales`, severity `info`, impact `ranking`,
  `context: true` (a status row, like `locale_single` — the actionable recs live
  in the expansion card, per the #71-C no-double-count rule).
- Title: `Listed in 1 language (English)`. Detail names how many **large-tier**
  storefronts in other languages the static model ranks (a measured count of a
  bundled heuristic, e.g. "6 large storefronts in other languages are separate
  keyword surfaces you haven't claimed"). NOT the draft copy "N of your tracked
  keywords have high-volume non-EN markets" — we do not measure per-market
  keyword volume, so that sentence would fabricate (see honesty rules).

**Downstream tie** (no code here): the expansion card is the entry point for
localization Phase 4's "Generate draft" action — this PRD makes that card exist
for keyless users, widening the funnel into the per-locale draft flow.

## Honesty rules (hard)

- `languages[]` is **measured page data**. Absent (unreadable page, shelf drift)
  → no coverage object, no finding, no recommendation change. A missing source
  degrades the field, never the run — and absence is unknown, never "EN-only".
- **Language-level is labeled language-level.** Storefront coverage never claims
  locale-level knowledge; UI copy says "listed in N languages", never "live in
  N locales". `source: "storefront"` travels with the data.
- **Conservative exclusion**: every locale of a listed language is excluded from
  recs. We never call a surface unclaimed unless no listed language covers it.
- **No fabricated volume.** Finding copy uses measured counts (languages read,
  tracked-keyword count from `ranks`) and the static model's tier descriptors.
  Never "high-volume keywords in market X" — per-market volume is unmeasured.
- **Unmapped language names are surfaced** (`unmappedLanguages`), never silently
  dropped, never guessed into a locale code.
- ASC-sourced coverage (keyed runs) always wins; storefront never overrides it.

## Test plan (specs first, red before green)

- `languageCoverage.spec.ts`: EN-only → all 8 English codes covered, effort
  "translate", ≥5 recs, none English; multi-language input tapers count and
  flips effort; unknown name lands in `unmappedLanguages` and excludes nothing;
  `[]` → empty coverage, zero recs; determinism (same input, identical output).
- `auditFindings.spec.ts`: `language_single` fires keyless with one language;
  absent `audit.storefront`/`languages` → no finding; keyed run with
  `snapshot.locales` → suppressed (only `locale_single`); detail contains no
  volume claims (assert copy).
- Route/serialize: keyless run response carries `localizationExpansion` +
  `languageCoverage` and survives the `runs.reasoning_json` round-trip; keyed
  response is byte-identical to today's.

## Non-goals

- Any write path (drafting/pushing locales — that's `docs/prd/localization/`).
- A keyed-run cross-check ("ASC says 3 locales, page says 1 language") — open
  question below, not v1.
- Play listing languages; per-market keyword volume; changing `locales-data.json`
  scoring.

## Open questions

- Cross-check finding on keyed runs: is an ASC-vs-storefront language mismatch a
  useful drift signal or noise (propagation delay makes it flappy)?
- Should `coveredLocales` for "English" seed the localization flow's language
  picker (skip-list), or stay display-only until Phase 4 lands?
- Storefront language names vary by the storefront the page was fetched from
  (a de-DE page lists "Deutsch"). We fetch US pages today — pin that assumption
  in a test, or normalize names before mapping?
