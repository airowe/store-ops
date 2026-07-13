# Google Play — new data surfaces, scoped for build (2026-07)

> Companion to `01-data-map.md`. That doc **found** the surfaces (the 2026-07 research
> refresh: Data-Safety write API, four new vitals metric sets, the BigQuery/GCS funnel,
> and the two rejected undocumented APIs). This doc turns the *keepers* into **scoped,
> honesty-preserving build increments** — each one file-by-file, each reusing machinery
> we already shipped, each independently landable behind the same seams the rest of the
> Play engine uses (`isFlagOn(env.X)`, injected sources, degrade-safe readers).
>
> Status: **proposal / not yet built.** Ordered by value ÷ effort. Nothing here needs a
> new paid dependency; the funnel item (D) is the only one that adds real infra.

## What changed vs `01`'s original opportunity list

`01 §6` was written before we shipped the keyless reader, the vitals finding (#220), and
the category chart rank (#221). Those are **done**. The 2026-07 refresh adds four *new*
buildable surfaces on top — this doc scopes them so they don't sit as prose in the data map:

| # | Surface | Trust tier | Extends | Effort |
|---|---------|-----------|---------|--------|
| **A** | **Vitals expansion** — 4 new metric sets → findings | 🔒 owner | #220 `playVitals.ts` | **XS** |
| **B** | **Data-Safety write / close-the-loop** — propose + push the corrected declaration | 🔒 owner | #178 lint + the optimizer's propose→approve→push loop | **M** |
| **C** | **Data-Safety ↔ privacy-policy consistency lint** (keyless) | 🌐 public | `playFindings` + #178 corpus | **S** |
| **D** | **Play funnel ingest** — GCS/BigQuery acquisition + conversion series | 🔒 owner | the iOS Engagement ingest (analytics-reports `02`) | **L** |

Explicitly **still NOT built** (no honest source — `01 §4`): experiment/PPO results, CPP
conversion, a conversion *query* API, keyword volume. Nothing below fabricates them.

---

## A. Vitals expansion — 4 new metric sets → findings  🔒  (XS, do first)

**Why.** #220 already reads `vitals.crashrate` / `vitals.anrrate` and cites the
documented visibility threshold. The rev-20260709 Discovery doc exposes **four more**
Google-measured quality sets — `excessivewakeuprate`, `stuckbackgroundwakelockrate`,
`slowrenderingrate`, `lmkrate` (low-memory-kill). Each is the *same* shape as the two we
already read (a `:query` POST returning a daily timeline), so this is pure fan-out over the
reader we have — the cheapest new measured signal on the board.

**Honesty line.** Crash/ANR are *documented* ranking-visibility levers (`01 §0.4`) — assertable
as fact with a citation. The four new ones are **documented technical-quality bad-behavior
metrics** but Google does **not** state they gate store visibility the way crash/ANR do. So
they ship as **`impact: "conversion"` / `context`** quality findings ("Google flags your slow
rendering rate as poor behaviour"), **not** as ranking claims. Keep the `impact` split honest.

**Files.**
- `engine/play/playVitals.ts` — generalize `readPlayVitals`/`playVitalsFindings` from a fixed
  crash+ANR pair to a **metric-set table**: `{ key, metric, thresholdPct?, impact, cite }`.
  Crash/ANR keep their verified thresholds + `impact:"ranking"`; the four new sets get
  `impact:"conversion"` and no hard threshold (report the measured rate + Google's "bad
  behaviour" framing, no fabricated cutoff). `extractLatestRatePct` already generalizes.
- `api/index.ts` — `readPlayVitalsFindings` already loops metric sets; extend the set list.
  No route change; still gated behind `PLAY_VITALS_ENABLED`.
- Tests: one fixture per new set (measured / degraded-to-nothing), mirroring the #220 specs.

**Ship criterion.** The four sets appear as findings in `PlayAuditCard` when the reporting
scope is granted; degrade to nothing otherwise. No new flag.

---

## B. Data-Safety close-the-loop — propose + push the declaration  🔒  (M)

**Why.** This is the first Play surface where we can go from *audit* to *fix-and-push* on the
owner tier, because §3.1 now has a **write** verb (`POST applications/{pkg}/dataSafety`,
`SafetyLabelsUpdateRequest` with a `safetyLabels` CSV). Today we can only lint the data-safety
form (read); now the optimizer's existing **propose → human-approve → push** loop can carry a
corrected declaration end-to-end — the exact pattern the ASC write path already follows.

**Honesty / safety line.** Data-safety is a **legal declaration**, not marketing copy — so
this is the one place we must be *most* conservative: **never auto-generate or auto-push a
declaration.** We propose a *diff* (e.g. "your scraped listing collects location but the
declaration omits it — add it?") the human edits and confirms; the push is a single explicit
approved action, and like every write it is gated + reversible-by-review. The write API is the
mechanism; the guardrail is that a human owns every claim in a compliance form.

**Files.**
- `engine/play/playDataSafety.ts` (new) — types for the CSV schema + a pure
  `buildSafetyLabelsCsv(declaration)` and its inverse parse; no network.
- `engine/play/playDeveloperApi.ts` — add the write transport verb (mirrors the read verbs).
- `api/index.ts` — a new gated route `POST /apps/:id/play-data-safety` behind
  `PLAY_DATA_SAFETY_WRITE_ENABLED`, owner-scoped, that takes the human-approved declaration and
  pushes it. Read/propose is unflagged; **write is flagged + approval-gated**.
- Web: a propose/confirm card (reuse the approval affordance from the ASC push UI).

**Ship criterion.** Owner sees a proposed data-safety diff grounded in the linted gap; nothing
is pushed without an explicit approve; flag off ⇒ read-only lint only (current behaviour).

---

## C. Data-Safety ↔ privacy-policy consistency lint  🌐  (S)

**Why.** A keyless, no-owner-key finding that rides the data we already scrape (`01 §1`
datasafety `ds:3` + `privacyPolicy` URL). It's `01 §6.5`'s "data-safety ↔ privacy-policy
consistency" bullet, now its own increment because it needs no write API and pairs naturally
with B. Purely additive to the `playFindings` rule set.

**Honesty line.** We flag **inconsistency we can observe** ("the listing declares data
collection but exposes no privacy-policy URL", "collects location but the policy page never
mentions it") — a *flag, not a verdict*, cited to Google's data-safety policy page like the
#178 corpus. We do **not** claim the app is non-compliant; we surface the gap for a human.

**Files.** `engine/play/playComplianceLint.ts` — add the consistency rules (reuse
`citePlayPolicy`); wire into `playFindings`. Fixture tests only. No route/UI change (surfaces
through the existing findings card).

---

## D. Play funnel ingest — the "conversion moved" story  🔒  (L, biggest)

**Why.** The refresh confirmed the **only** official Play funnel source: the GCS
`pubsite_prod_rev_*` export / **BigQuery Data Transfer** "Google Play" connector, which
*does* carry the store-listing acquisition + **conversion-analysis funnel** (monthly, ~3–7 day
lag) since the 2021 refresh. This is the Play sibling of the iOS Engagement/acquisition series
(analytics-reports `02`–`03`) — the thing that lets a Play owner see "conversion moved after
your change," which is ShipASO's core proof loop.

**Honesty line.** It is **monthly and lagged** — so every Play conversion number is stamped
"monthly, through <period>," never implied to be live (contrast the iOS series). No `:query`
API exists (`01 §3.2` verified absence), so we never pretend to a real-time funnel. Movement is
correlational (same stance as rank attribution): "after your change, monthly conversion moved
X," never "caused."

**Files (mirrors the iOS ingest, so most machinery is a port).**
- `engine/play/playFunnelParse.ts` (new) — pure CSV/BigQuery-row → normalized funnel series
  (store-listing visitors → acquisitions → conversion rate), TDD like the Engagement parser.
- D1: a `play_funnel_snapshots` table + idempotent persistence (sibling of the Engagement series
  schema; a `wrangler` migration, **not** in `schema.sql` per the migration discipline).
- Ingest: an on-demand owner route that pulls the latest export (GCS read or BigQuery query with
  the connected service account) and persists; degrade-safe if the bucket/dataset is empty.
- Reuse the **measured-movement** surface (analytics-reports `03`) to render it — the card is
  store-agnostic if we feed it the normalized series.

**Ship criterion.** A connected Play owner sees a monthly conversion series with an explicit
"monthly / through <period>" stamp; movement annotates against their push log; empty export ⇒
honest "no funnel data yet," never a zero.

---

## Sequencing

1. **A (vitals expansion)** — XS, pure fan-out over #220, no new flag surface. Land first.
2. **C (data-safety consistency lint)** — S, keyless, additive finding. Quick win, no owner key.
3. **B (data-safety write)** — M, the first owner-tier *fix-and-push* on Play; gated + approval-bound.
4. **D (funnel ingest)** — L, the marquee proof feature; ports the iOS Engagement machinery.

Each is independently shippable, leaves iOS untouched, and preserves the measured-or-null,
flag-and-cite, degrade-safe discipline the Play engine already follows. The rejected surfaces
(`01 §7`) and the ⛔ gaps (`01 §4`) stay out of scope by construction — we build what has an
honest source and surface the rest as capability gaps.
