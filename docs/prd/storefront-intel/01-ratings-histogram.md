# PRD 01 — Ratings histogram → an honest review/ratings signal

> The storefront page seam (`audit.storefront`, commit `88cb191`) now carries
> Apple's own ratings read: `{ average, count, histogram[5] }` — the 1★→5★
> distribution across **all** ratings, not just written reviews. Turn it into a
> pure signal + two findings.

## Strategic frame

Every ASO tool shows the star average; almost none read the *shape*. The RSS-based
`reviewSentiment` (#95, `cloud/src/engine/reviewSentiment.ts`) sees only recent
*written* reviews (a small, self-selected sample it honestly labels `n=`); the
histogram is Apple's measured distribution over the whole ratings base — the two
are complementary, and the histogram catches what the sample can't: polarization
(a bimodal 1★/5★ split hiding behind a bland 3.9 average) and genuinely thin
ratings. This is a cheap, differentiated read off a fetch we already make.

## Deliverable

**New pure module `cloud/src/engine/ratingsSignal.ts`** (engine rules: pure,
deterministic, no bindings, no fetch — the data arrives via `audit.storefront`):

```ts
export type StorefrontRatings = NonNullable<StorefrontIntel["ratings"]>; // { average, count, histogram }

export type RatingsSignal = {
  average: number;                                  // Apple's number, verbatim
  count: number;                                    // Apple's number, verbatim
  /** 1★→5★ shares (sum ≈ 1) — present ONLY when the histogram was readable
   *  (exactly 5 buckets, sum > 0). Absent histogram ⇒ absent shares, never zeros. */
  shares?: [number, number, number, number, number];
  /** share(1★)+share(5★), and the bimodal call — absent whenever shares are. */
  polarization?: { score: number; bimodal: boolean };
  /** Apple-count-is-thin status: count < RATINGS_THIN. */
  thin: boolean;
};

export const RATINGS_THIN = 50;          // below: don't editorialize the shape
export const MIN_RATINGS_FOR_SHAPE = 200; // below: never call "polarized"

export function ratingsSignal(ratings: StorefrontRatings | undefined): RatingsSignal | undefined;
```

- `undefined` in → `undefined` out (unread page stays unknown).
- Proposed bimodal rule (named constants, tunable): `share(1★) ≥ 0.15 && share(5★) ≥ 0.50
  && count ≥ MIN_RATINGS_FOR_SHAPE`.

**Findings** — new `ratings` rule set in `cloud/src/engine/auditFindings.ts`
(surface `"ratings"`, low-signal like `reviews`: **never `critical`**):

1. `ratings_polarized` (`warn`, impact `trust`) — bimodal shape detected. Title
   "Ratings are polarized (…)"; evidence carries the observed shares verbatim,
   e.g. `1★ 22% · 5★ 61% (n=4,812)`. Fix copy: find what the 1★ cohort hits
   (cross-reference the reviews topics when present).
2. `ratings_thin` (`info`, impact `trust`, `context: true`) — `signal.thin`.
   Framed as Apple's own status ("Only N ratings — too few to read the shape"),
   a fact that frames the audit, never a deficiency claim about the app.

**Wiring** — `AuditFindingsInput` gains `storefront?: StorefrontIntel | undefined`;
both `auditFindings({...})` call sites in `cloud/src/api/index.ts` (~1333 no-key,
~1501 ASC) pass `result.audit.storefront`. `ratingsFindings()` calls
`ratingsSignal(input.storefront?.ratings)` internally.

**Run trace** — nothing new to persist: `audit.storefront.ratings` already rides
`runs.reasoning_json` (see `runSerialize.spec.ts`), and the findings ride
`result.findings` like every other surface. The run page renders them for free.

## Honesty rules (verbatim, binding)

- `storefront`/`ratings` absent ⇒ no signal, no findings. Unknown is absent,
  never zero, never an empty histogram treated as "no ratings".
- The extractor's `histogram: []` fallback means *unreadable*, not "all zeros":
  `shares`/`polarization` are absent and both findings are suppressed — but
  `average`/`count` (independently measured) still carry.
- `average` and `count` are Apple's own measured numbers; quote them verbatim in
  evidence, never recompute or round them into a different claim.
- "Thin" is a statement about the **count**, echoing Apple's own "Not Enough
  Ratings" stance — never "your app is bad" or a projected score.
- Never blend histogram numbers with the RSS review sample: each figure is
  labeled with its source (`n=<count> ratings` vs the sentiment's `n=<sample>`),
  and neither is extrapolated into the other.
- A missing histogram degrades the shape fields only — never the ratings facts,
  never the run (safe-degrade everywhere).

## Test plan (TDD — specs first, red, then implement)

`cloud/src/engine/ratingsSignal.spec.ts` (pure, no mocks):
- `undefined` → `undefined`; `histogram: []` → signal with `average`/`count` but
  no `shares`/`polarization`.
- Parameterized histograms: U-shape (bimodal `true`), J-shape/uniform/5★-heavy
  (`false`); shares sum to 1; below `MIN_RATINGS_FOR_SHAPE` never bimodal even
  with a U-shape.
- `thin` boundary: `RATINGS_THIN - 1` true, `RATINGS_THIN` false.

`cloud/src/engine/auditFindings.spec.ts`, new describe:
- Polarized input emits exactly `ratings_polarized` with the exact evidence
  string; thin input emits `ratings_thin` with `context: true`.
- `storefront` absent / `ratings` absent / `histogram: []` ⇒ zero `ratings`
  findings; invariant: no `ratings` finding is ever `critical`.

Gates from `cloud/`: `npm run typecheck` + `rtk proxy npx vitest run` green.

## Non-goals

- **Ratings-vs-competitor gap** — `similarApps[]`/tracked competitors carry
  `rating`/`ratingCount`, but "your 4.2 vs the shelf's 4.6" needs its own honest
  framing (whose shelf? measured how?). Deferred to PRD 02 of this suite.
- Histogram trend over runs (needs per-run history first), Play-store ratings,
  review-response coaching, and any blending of the histogram into the
  `reviewSentiment.score`.

## Open questions

1. Bimodal thresholds (0.15 / 0.50 / 200) are proposals — tune against a corpus
   of real storefront pages before promoting `ratings_polarized` copy?
2. Should `reviews_sentiment_summary` cite the histogram count as context
   ("sample of N of Apple's M ratings") once both surfaces are present?
3. Is `ratings_thin` worth showing on huge-catalog categories where <50 ratings
   is the norm, or should it gate on app age / rank presence?
