# LocalizeRank loop — Phase 1 + 2 (#180)

## What's built (verified)

- `rank_snapshots.country` (migration 0002) + `persistRankSnapshots(db, { appId, ranks, country })` — per-storefront rank writes.
- `getRankHistory(db, appId, { keyword?, country?, limit? })` — country-scoped rank history (oldest→newest).
- `listTrackedMarkets(db, appId)` — the storefronts that actually have data (never a guessed list).
- `RankSnapshotRow = { keyword, rank, total, country, checked_at, … }`.
- `rankAttribution.ts` — the before/after movement vocabulary (`MovementDirection = up|down|new|lost|same`, `RankMovement { from, to, delta, direction }`) with strict correlational framing ("followed your push", never "caused").
- `languageCoverage.ts` — `recommendLocalesFromLanguages` (measured locale recommendation) + `coverageFromLanguages`.
- `RunResult.localizedCopy` — the locales the human approved (the markets a localized push targeted).

## The gaps this builds

The primitives exist but the **loop pieces** don't:
1. **Phase 1 — per-market rank PROOF.** Nothing assembles per-storefront rank history into a before/after "your localized push moved you +N in <market>" proof. Without this, localization value is unprovable (the issue's load-bearing point).
2. **Phase 2 — market-picker finding.** The expansion heuristic exists but isn't surfaced as an explicit, honestly-reasoned "your next N markets" recommendation on the run.

Both are **pure engine + findings** that ride existing surfaces (the rank-history reader, the findings card). No new schema, no new write.

## Honesty rules (from the issue)

- **A localized market gets its own MEASURED baseline before/after** — no blended global claims. Each market's proof is computed only from that market's `country`-scoped snapshots.
- **Correlational, never causal** — "since your <locale> push (date), <keyword> moved <from>→<to> in <market>" — never "your push caused". Reuses `rankAttribution`'s exact vocabulary.
- **Measured or absent** — a market with < 2 snapshots (no before AND after) yields **no proof** ("not enough measured history in <market> yet"), never a fabricated movement. A `null` rank stays "unranked", never a fake position.
- **Market recommendations state their inputs; no fabricated market-size scores** — the picker reasons only from measured language coverage + the category, never an invented TAM.

## Component 1 — per-market rank proof (pure, tested)

`cloud/src/engine/marketRankProof.ts`:

```ts
import type { RankSnapshotRow } from "../d1.js";
import type { MovementDirection } from "./rankAttribution.js";

export type MarketKeywordMove = {
  keyword: string;
  from: number | null;   // earliest snapshot in-window (null = was unranked)
  to: number | null;     // latest snapshot (null = now unranked)
  delta: number | null;  // to - from (negative = improved); null if either null
  direction: MovementDirection;
};

export type MarketProof = {
  country: string;           // the storefront (lowercased)
  /** ISO of the localized push this market's window is measured against, if known. */
  since?: string;
  keywords: MarketKeywordMove[];
  /** climbed − dropped across the market's keywords (a summary, not a claim). */
  netImproved: number;
  /** false when the market has < MIN_SNAPSHOTS distinct dates → no proof yet. */
  measured: boolean;
};

export const MIN_SNAPSHOTS = 2;

/**
 * Assemble per-market rank proof from country-scoped snapshots. Groups rows by
 * (country, keyword), takes the earliest-in-window vs latest snapshot per keyword,
 * and classifies the move with rankAttribution's vocabulary. A market with fewer
 * than MIN_SNAPSHOTS distinct dates is emitted `measured:false` (no fabricated
 * movement). `since` scopes the window to on/after a localized push date when given.
 */
export function buildMarketProof(
  rows: RankSnapshotRow[],
  opts?: { since?: Record<string, string> },  // country → push ISO date
): MarketProof[];
```

- Pure over rows the caller reads via `getRankHistory` per market (or one broad read grouped by country). Deterministic; unit-tested with fixture rows.
- `since[country]` (from the approved localized-push timestamp) trims each market's window to on/after the push, so the proof is "since you localized", not all-time. Absent → whole history.
- `direction` via the same rules as `rankAttribution` (new/lost/up/down/same), so the vocabulary can't drift.

## Component 2 — market-proof findings

`marketRankProof.ts` `marketProofFindings(proofs, opts?) -> Finding[]`:
- A `measured` market with net improvement → an **info** finding: "Since your <locale> localization, you've climbed in <market>: <k> keywords up, net <n> positions (measured in the <market> App Store, correlational)." Quotes the market's own numbers; `impact: "localization"`.
- A `measured` market that's flat/down → the honest same finding worded neutrally (no spun win).
- An unmeasured market → **no finding** (silent; never "not enough data" noise unless the market was explicitly pushed — then a gentle "we'll have proof after the next <market> snapshot").

## Component 3 — market-picker finding (Phase 2)

`cloud/src/engine/marketPicker.ts` (thin — mostly reuses `recommendLocalesFromLanguages`):

```ts
export type MarketPick = { locale: string; reason: string };
export function pickMarkets(input: {
  currentLanguages: string[];   // measured coverage (from languageCoverage)
  categoryName?: string;
  alreadyLocalized: string[];   // approved locales — don't re-recommend
  limit?: number;               // default 3
}): MarketPick[];
export function marketPickerFindings(picks: MarketPick[]): Finding[];
```

- Wraps `recommendLocalesFromLanguages`, filters out `alreadyLocalized`, caps at `limit`, and each pick carries its **measured reason** (coverage gap + category), never a TAM number.
- `marketPickerFindings` → one "your next N markets" finding listing the picks + their reasons. `impact: "localization"`.

## Wiring

- `auditFindings.ts`: add `...marketProofFindings(...)` and `...marketPickerFindings(...)` to the assembled findings — but only with the inputs available on the run. The rank rows + approved locales + language coverage are already read into the audit input / run result; thread them in (mirrors how `ppoFindings` gets `snapshot.experiments`). Where an input isn't present (keyless / no history), the functions return `[]` (silent).

## Testing

- `marketRankProof.spec.ts`: group-by-market; earliest-vs-latest per keyword; `direction` classification incl. null (new/lost); `since` window trimming; `measured:false` under MIN_SNAPSHOTS (no fabricated move); netImproved math; empty rows → [].
- `marketProofFindings`: measured-up → a correlational finding quoting the market's numbers (asserts no "caused"); flat/down → neutral wording; unmeasured → silent.
- `marketPicker.spec.ts`: filters already-localized; caps at limit; each pick has a measured reason (no TAM); empty coverage → [].
- Finding wiring: an audit with per-market history + approved locales surfaces the proof finding; without them, silent.

## Out of scope (explicit — tracked follow-ups)

- **Phase 3** locale-native keyword targeting ("the hard, differentiated part") — its own build; must be substantiated by locale data, never translated en-US.
- **Phase 4** screenshot localization — ties into ShipShots (#153/#154); separate.
- **Collecting** additional-market snapshots in the cron (the daily sweep still ranks only `app.country`) — a small wiring follow-up; this PR proves whatever per-market data exists (e.g. from a localized push's own rank check) and is correct the moment that collection is added. Noted so it's not a silent gap.
