# PRD 05 — The audit card (a shareable artifact for the audit)

> Our audits are better analysis than the competition's and **nobody will ever
> screenshot one.** A single AppKittie card got 3.8K views on X because it is a
> self-contained image someone can post. This plans the equivalent artifact for
> ShipASO's audit — built on measured data only, which is the thing AppKittie
> structurally cannot do.

## The prompt

[This post](https://x.com/tadasgedgaudas/status/2082377784635088934) — the
author states the source outright: *"screenshot is from appkittie.com"*.
AppKittie is the competitor already named in `visual-assets/00-overview.md:14`.

Their card for *Livity: Sleep & Health Tracker* shows: icon, name, developer,
release + last-update dates, category chips, IAP range, sentiment split, then
two large hero numbers — **Est. Monthly Downloads 33K** and **Est. Monthly
Revenue $65K** — then creators/ad-count tiles, size/platform/rating tiles, and a
screenshot strip.

## Why we cannot copy it, and why that is the opportunity

Their two hero numbers are **modeled estimates**. Ours would be
measured-or-nothing (`CLAUDE.md` invariant 1). Copying the card means either
inventing numbers or shipping a card with two blank hero tiles.

The inversion: **AppKittie estimates everyone's numbers; with the user's own key
we KNOW theirs.** Apple's Analytics Reports API returns first-party downloads
and proceeds. So the card is not "AppKittie but honest" — it is a different
claim:

> Their number is a guess about you. Ours is Apple's number, for you, with the
> date range on it.

That claim only works for the user's **own** apps. It does not work for
competitors, and the card must never imply otherwise.

## Field inventory — sourced, and honestly

Verified live against `com.chat.swoop` while writing this PRD.

| Field | Source | Status |
|---|---|---|
| Icon, name, developer | iTunes Lookup | ✅ free |
| Released / last updated | iTunes Lookup | ✅ free |
| Category + secondary genre | iTunes Lookup | ✅ free |
| Price / IAP range | iTunes Lookup | ✅ free |
| Size, platforms, rating + count | iTunes Lookup | ✅ free |
| Screenshot strip | iTunes Lookup | ✅ free (thumbnails) |
| **Downloads** | Analytics `App Downloads Standard` | ⏳ needs Admin key + Apple's 1–2 day generation |
| **Proceeds** | Analytics Commerce | ⏳ same, and Commerce is out of scope until PRD 02 ships |
| Sentiment split | Own reviews (`asc reviews list`) | ⚠️ derivable, but see below |
| Creators / ad counts | Social + ad-library scrape | ❌ **out of scope** — not measured, not our lane |

### Live findings that constrain this

- **The analytics request path works.** `asc analytics request --app 6749875510
  --access-type ONGOING --reuse-existing` returned
  `{"created": true}`, and `asc analytics requests` shows it ONGOING with
  `stoppedDueToInactivity: false`. The key has sufficient role to *request*.
- **`App Downloads Standard` exists** as report
  `r3-<requestId>`, category COMMERCE, alongside `App Downloads Detailed`.
- **Instances are empty right now.** `asc analytics reports links --report-id
  r3-…` → `instances: 0`. This is Apple's documented 1–2 day generation window
  (`00-overview.md`), **not** a permission failure — the request is healthy.
  The card must therefore ship with a real pending state, not a zero.
- **Sentiment is not computable for a new app.** Swoop has **0 written
  reviews** (confirmed twice: public RSS + authenticated `asc reviews list`).
  AppKittie shows "54.6% positive / 45.5% negative" for an app with 955
  ratings. For a young app the honest render is `—`, and the card must not look
  broken when that is the answer.

## The deliverable

`cloud/src/engine/auditCard.ts` — pure, shaped like the existing engine modules:

```ts
export type CardValue<T> =
  | { state: "measured"; value: T; asOf: string; source: string }
  | { state: "pending"; reason: string }     // requested, Apple generating
  | { state: "unavailable"; reason: string } // role gap, or no data exists
  | { state: "absent" };                     // genuinely zero/none, measured

export type AuditCard = {
  identity: { name: string; developer: string; iconUrl: string;
              released: string; lastUpdated: string };
  chips: { category: string; secondary?: string; price: string; iap?: string };
  hero: { downloads: CardValue<number>; proceeds: CardValue<number> };
  tiles: { rating: CardValue<{ avg: number; count: number }>;
           size: CardValue<string>; platforms: CardValue<string[]>;
           sentiment: CardValue<{ pos: number; neg: number }> };
  aso: { grade: string; rankSummary: CardValue<RankSummary>;
         topFindings: Finding[] };   // OUR differentiator — see below
  screenshots: string[];
};

export function auditCard(input: AuditCardInputs): AuditCard;
```

`CardValue` is the load-bearing type. A four-state union makes
measured-or-nothing **structurally enforced** rather than a review-time
discipline — you cannot render a number without also carrying its provenance,
and "pending" is distinguishable from "zero" in the type system.

## What makes it ours, not a clone

AppKittie's card is inventory. Ours must carry the **finding** — the thing that
came out of reasoning and cannot be scraped. From the Swoop audit, the card's
headline would be:

> **Found for 3 of 13 keywords tested. Best rank #64.** The only terms that rank
> are already in the name/subtitle — the 100-char keyword field is inert.

No AppKittie card can produce that sentence. It requires `aso-rank-check` plus
the metadata read plus the reasoning that connects them. **If the card ships
without the finding, we have built a worse AppKittie.**

## Honesty rules (hard)

- **No modeled numbers, ever.** If Apple hasn't returned it, it renders `—` with
  a reason. We never estimate downloads or revenue, and never blend a scraped
  proxy into a hero tile.
- **Pending ≠ zero.** During Apple's generation window the tile says "requested
  — Apple takes 1–2 days," never `0`.
- **Own apps only.** The card is for apps the user holds credentials for.
  Rendering it for a competitor (with estimates) is the exact line we don't
  cross — that IS AppKittie.
- **Every number carries its window.** "33K" is meaningless; "33K downloads,
  Jul 1–31, Apple Analytics" is a claim. `asOf` + `source` are required fields,
  not decoration.
- **Rank is a snapshot.** Card rank numbers carry "US, top-200, <date>" — one
  point, not a trend (same discipline as the audit).
- **Sharing is opt-in and reviewed.** A card is an outward-facing artifact
  containing the user's revenue. It is generated locally; publishing anywhere is
  an explicit, separate action the user takes.

## Open questions (decide before building)

1. **Render target.** Static SVG/PNG (screenshot-native, works everywhere) vs. an
   HTML page (linkable, themeable, live). The X-post use case argues image;
   the existing `/report/:appId` route argues page. Possibly both, one source.
2. **Where it lives.** `lib/` (Python, mirrors the render path in
   `render_localized_shots.py`) vs. `cloud/src/engine/` (TS, near the data).
   The `lib/` ↔ `engine/` mirror is load-bearing — pick one and say why.
3. **Does proceeds ship in v1?** It needs Commerce ingest, which
   `00-overview.md` explicitly defers past Phase 2. A downloads-only card may be
   the honest v1.
4. **Non-Admin keys.** If the key can't request analytics, does the card ship
   metadata + ASO findings with both hero tiles `unavailable`? (Recommended
   yes — the ASO finding is the differentiator, and it needs no Admin role.)

## Dependencies

- **Blocks on `01-request-lifecycle.md`** for the request + Admin detection, and
  on `02-engagement-ingest.md` for actual download numbers.
- The metadata/ASO half has **no blockers** — it is buildable today from the
  free iTunes read plus `aso-rank-check`, both already working.

## Acceptance

- Renders from measured data with a four-state `CardValue` on every number.
- A brand-new app with no analytics, no reviews, and no rank renders a card that
  looks *intentional*, not broken.
- The ASO finding is present and prominent — the card is never pure inventory.
- No code path can emit an estimated download or revenue figure.
