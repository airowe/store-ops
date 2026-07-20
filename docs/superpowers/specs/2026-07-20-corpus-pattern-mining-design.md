# Corpus pattern-mining (#64)

## Goal

Once the corpus (#63) accrues history, surface PATTERNS in what VISIBLE changes preceded rank movement — "apps that added a term to their name tended to climb for it." Output: ranked **hypotheses** with their sample size + the actual supporting examples, feeding the AI keyword-targeting step later (#57).

## Decision (from scoping)

**Build the engine now; it runs on real data later.** The corpus is empty until #63 is enabled and accrues weeks of history, so this engine must produce **honest empty/"not enough data" output on thin data** and only assert a pattern when the sample clears a threshold. Tested against fixtures now; produces real hypotheses once the corpus fills.

## State it depends on (from #63, just shipped)

- `corpus_snapshots` — per `(seed_keyword, country)`, dated rows of `{ bundle_id, name, category_id, rank, version, rating, rating_count, description, checked_at }`. VISIBLE fields only (no subtitle/keyword field). A `null` rank = beyond the cap.
- `CorpusRow` shape + `persistCorpusSnapshots` in `d1.ts`.

## Honesty rules (hard — from the issue)

- **Correlational, never causal.** Every output says "apps that did X *tended to* climb", never "do X to rank." No recommendation wording.
- **Show sample size + the real examples.** Never a confident pattern from thin data; a pattern under `MIN_SUPPORT` is withheld or labeled insufficient.
- **VISIBLE changes only.** We can't see subtitle/keyword-field edits, so the patterns are inherently partial — every report states this limit.
- **A `null`→ranked or ranked→`null` move is "entered/left the tracked top-N", not a fabricated absolute rank.**

## The change→move sequence (what we mine)

For each `bundle_id` observed at two times `t0 < t1` under the same `(seed_keyword, country)`:
- **rank move** = `rank(t0) - rank(t1)` (positive = climbed; lower rank number is better). `null` handled explicitly: `null→N` = "entered top-N" (a climb event), `N→null` = "left top-N" (a drop event), `null→null` = no signal.
- **visible changes** between t0 and t1, each a discrete typed event:
  - `name_added_seed` — the seed keyword appears in `name(t1)` but not `name(t0)`.
  - `name_changed` — name differs (any change).
  - `version_bumped` — version changed (a release shipped).
  - `rating_up` / `rating_down` — averageUserRating moved beyond a small epsilon.
  - `description_grew` / `description_shrank` — description length moved beyond an epsilon.

These are the changes iTunes actually exposes. The report header states the blind spots (subtitle, keyword field).

## Component 1 — the mining engine (pure, fixture-tested)

`cloud/src/engine/corpusPatterns.ts`. Consumes plain rows (the caller reads them from D1; the engine stays pure/testable):

```ts
export type CorpusPoint = {
  seedKeyword: string; country: string; bundleId: string;
  name: string; rank: number | null; version: string;
  rating: number | null; description: string; checkedAt: string;
};

export type ChangeType =
  | "name_added_seed" | "name_changed" | "version_bumped"
  | "rating_up" | "rating_down" | "description_grew" | "description_shrank";

/** One observed (change → move) transition for one app under one seed. */
export type Transition = {
  seedKeyword: string; bundleId: string;
  changes: ChangeType[];
  rankMove: number | null;         // >0 climbed; null when the move isn't a number
  event: "climbed" | "dropped" | "entered" | "left" | "flat";
  from: number | null; to: number | null;
};

/** Pair consecutive snapshots per (seed, country, bundle) → transitions. */
export function buildTransitions(points: CorpusPoint[]): Transition[];

export type Hypothesis = {
  seedKeyword: string;
  change: ChangeType;
  /** apps with this change that climbed / entered, over apps with this change. */
  climbRate: number;
  support: number;               // how many transitions had this change (sample size)
  climbers: number;
  examples: Array<{ bundleId: string; from: number | null; to: number | null }>; // real supporting rows
  sufficient: boolean;           // support >= MIN_SUPPORT
};

/**
 * Rank hypotheses: for each (seedKeyword, changeType), the correlational climb
 * rate + support + real examples. Sorted by (sufficient desc, support desc,
 * climbRate desc). A change under MIN_SUPPORT is either omitted or, if included,
 * marked sufficient:false — never a confident pattern from thin data.
 */
export function mineHypotheses(
  transitions: Transition[],
  opts?: { minSupport?: number; includeInsufficient?: boolean },
): { hypotheses: Hypothesis[]; totalTransitions: number; blindSpots: string[] };
```

- `MIN_SUPPORT` default 20. `blindSpots` is a fixed statement of what we can't see (subtitle, keyword field) so every consumer surfaces it.
- Empty/thin input → `{ hypotheses: [], totalTransitions, blindSpots }` — never a fabricated pattern.
- `climbRate` counts `entered` + `climbed` as positive outcomes; the `event` classification keeps `null` handling explicit (no fake ranks).

## Component 2 — the reader + a phrased summary

- `d1.ts` `readCorpusPoints(db, opts?: { seedKeyword?; country?; sinceDays?; limit? }) -> CorpusPoint[]` — a scoped read of `corpus_snapshots` ordered by `(seed_keyword, bundle_id, checked_at)`, so `buildTransitions` can pair consecutive rows. Bounded `limit`.
- `corpusPatterns.ts` `phraseHypothesis(h) -> string` — the human line, strictly correlational: `"Apps that {change} tended to climb for \"{seed}\" ({climbers}/{support} did; correlational, visible changes only)"`, or for insufficient: `"\"{seed}\" + {change}: only {support} examples — not enough to call a pattern yet."` Pure, unit-tested for the "tended to / not enough" wording (no "do X").

> **No route/UI in this PR.** #64 is explicitly the largest/latest, gated on real corpus data, and pairs with #57. This ships the tested engine + reader; wiring it into the keyword-targeting step + any surface is a follow-up once the corpus has data — same posture as building against an empty table honestly.

## Testing

- `corpusPatterns.spec.ts`:
  - `buildTransitions` — pairs consecutive snapshots per (seed,bundle); rank move sign; `null→N` = entered, `N→null` = left, `null→null` = no signal; detects each ChangeType (name_added_seed vs name_changed, version bump, rating up/down beyond epsilon, description grow/shrink).
  - `mineHypotheses` — climb-rate math; support = sample size; sorted order; `MIN_SUPPORT` gating (thin change → omitted or insufficient); empty input → empty hypotheses + blindSpots present; examples are real rows from the input.
  - `phraseHypothesis` — "tended to" for sufficient, "not enough to call a pattern" for insufficient; NEVER contains an imperative ("do ", "add ", "should").
- `d1.corpusReadSchema.spec.ts` (or extend the #63 schema spec) — `readCorpusPoints` round-trips against real SQLite: scoping by seed, ordering by checked_at.

## Out of scope (explicit)

- Wiring hypotheses into #57 (AI keyword targeting) or any UI — follow-up once the corpus has weeks of data.
- LLM reasoning over the sequences — the issue frames an LLM step, but with an empty corpus that would reason over nothing; the deterministic correlational miner is the honest first layer and is what an LLM step would later summarize. Building the LLM narration now would be reasoning over fixtures, not data. Deferred until the corpus fills.
- Causal claims of any kind.
