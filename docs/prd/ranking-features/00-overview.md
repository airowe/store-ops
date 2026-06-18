# Ranking features — scoping overview

> We now CAPTURE the full ASC surface + rank history + competitor data, and we
> SURFACE findings about listing quality. The next layer turns that data into
> **ranking moves**: specific, provable actions that lift organic rank — and the
> proof that they did. Findings say "what's wrong"; these say "do X → rank moves
> → here's the receipt."

## The reframe: from audit to ranking engine

Three things make ShipASO's ranking advice better than a generic checklist —
**because we combine data most tools keep separate:**
1. **Rank history** (our weekly snapshots) — we know what *actually* moved, per keyword.
2. **Live ASC metadata** (the read) — we know exactly what the listing says now.
3. **Competitor listings + ranks** — we know who's beating you and on what.

A ranking feature that uses all three beats one that uses a keyword tool alone.

## The feature candidates (each scoped in its own PRD)

| PRD | Feature | The ranking lever | Data it fuses |
|-----|---------|-------------------|---------------|
| [`01-keyword-gap.md`](./01-keyword-gap.md) | **Keyword gap finder** | Find terms competitors rank for that you don't — and that fit your metadata budget | competitor listings + your ASC keywords + rank history |
| [`02-rank-tracker.md`](./02-rank-tracker.md) | **Rank tracker + movement attribution** | Tie each rank change to the metadata change that caused it ("you added 'stoic' → +14 on 'stoic'") | rank history + run/push log + ASC diffs |
| [`03-metadata-coverage.md`](./03-metadata-coverage.md) | **Metadata coverage score** | Quantify how much of your 30/30/100 char budget is working keywords vs waste (brand repeats, dupes, filler) | ASC name/subtitle/keywords + keyword scoring |
| [`04-localization-expansion.md`](./04-localization-expansion.md) | **Localization rank expansion** | Each locale is a new keyword surface; rank the highest-ROI locales to add for the app's category | ASC all-locales + category + (static) locale-value model |
| [`05-competitor-rank-war.md`](./05-competitor-rank-war.md) | **Competitor rank war room** | Head-to-head per-keyword rank vs chosen competitors, over time, with the gap to close | competitor ranks + your ranks + history (builds on #25) |
| [`06-rank-opportunity-score.md`](./06-rank-opportunity-score.md) | **Rank opportunity score** | Per keyword: rank it by *winnability* (volume × your-distance-to-top-10 × low-competitor-strength) so users chase the reachable wins | rank history + keyword scoring + competitor ranks |

## How they relate to what's shipped

- The **findings card** (just shipped) is the entry point — ranking findings
  (`secondary_category_missing`, `locale_single`, keyword gaps) link INTO these
  deeper tools. A finding is the headline; the PRD feature is the workbench.
- The **optimizer** already proposes copy; these features feed it better targets
  (the gap finder + opportunity score tell it WHICH keywords to chase).
- The **rank-delta card** already animates movement; #02 adds *attribution*
  (why it moved), #05 adds *competitor context*.

## Sequencing logic (not all at once)

**Highest leverage, mostly-have-the-data:**
1. **#06 Rank opportunity score** — reuses rank history + keyword scoring + competitor ranks we already compute. Turns "here are your ranks" into "here's where to push next." Low new-data cost, high user value.
2. **#01 Keyword gap finder** — the single most-requested ASO feature; we have competitor listings + ASC keywords already.
3. **#02 Rank attribution** — we have rank history + the run/push log; tie them. This is the PROOF feature — the thing that makes ShipASO sticky ("it shows me what worked").

**Then:** #03 coverage score (pure ASC + scoring), #04 localization (needs a locale-value model), #05 war room (builds on #25, the competitor-selectable deltas).

## Hard principles (carry from the rest of the product)

- **Don't over-claim.** Rank attribution is correlational (we can't prove
  causation) — say "after you changed X, rank moved Y," never "X caused Y."
- **Winnable, not just high-volume.** The opportunity score must weight *reachability*
  (distance to top-10, competitor weakness), or we send users to chase #1 for
  "games" forever. The honest signal is the moat.
- **ASC data deepens it but isn't required.** Each feature degrades gracefully
  without a key (public rank data still works); ASC unlocks the metadata-aware parts.
- **Findings only / privacy boundary** stays — no raw ASC dumps to the client.
- **Read + advise, not auto-act.** Ranking moves feed the optimizer's proposals;
  the human still approves every push.

## Next step
Pick the slice. My recommendation: **#06 (opportunity score) + #01 (keyword gap) +
#02 (attribution)** as the ranking trio — they're the highest-leverage, lean most
on data we already have, and together turn the audit into a ranking *engine*: find
the winnable target (06), find the gap (01), prove the move worked (02).
