# PRD — Rank intelligence T1: annotate rank timelines with observed metadata/version changes

**Issue:** #62 · **Tier:** T1 (near-term, low-data-risk, post-launch) · **Effort:** **M** · **Needs owner DECISION before building:** **Yes — one scoping decision** (see §8)

---

## 1. Problem & context

Today the app-detail page (`cloud/public/app.js:596` `viewApp`) shows two rank surfaces that are *disconnected from the events that moved the numbers*:

1. **Rank trend sparkline** — `GET /apps/:id/ranks` → `appRanks` (`cloud/src/api/index.ts:1072`) returns a single keyword's `{ rank, total, checked_at }` series, drawn by `sparkline(points)` (`cloud/public/app.js:2321`). It is a bare line: **no markers for *when* anything changed.** A user looking at a dip or climb has no way to see "a push landed here" or "a competitor shipped a new version there."
2. **Rank movement card** — `GET /apps/:id/deltas` → `appDeltas` (`cloud/src/api/index.ts:1119`) shows only the **latest** week-over-week delta per keyword, with the PRD-02 attribution line ("↳ after you added 'x' (Jun 12)") rendered in `rankMovementCard` (`cloud/public/app.js:703`). This is point-in-time, not a timeline, and it covers only **your** pushes — never competitor-visible changes.

So the central ASO question — **"what changed → what moved"** — is answerable in the data we already persist but is **not surfaced on the timeline**. We already have all three ingredients and they already meet our honesty bar:

- `rank_snapshots(app_id, keyword, rank, total, checked_at)` — per-keyword organic rank over time (`schema.sql:83`, read via `getRankHistory` `cloud/src/d1.ts:607`).
- `competitor_snapshots(app_id, comp_id, name, version, rating, seen_at)` — competitors' **visible** listing over time (`schema.sql:95`). We persist these every run (`persistRun` `cloud/src/d1.ts:508`) but **only ever read the *latest* one** (`getLatestCompetitorMap` `cloud/src/d1.ts:641`). The full per-competitor history is written and never read — pure waste of data we already paid to collect.
- `attributeRankMovements` (`cloud/src/engine/rankAttribution.ts:258`) already correlates "after you changed X, rank moved Y" with rigorous correlational-not-causal discipline, and `diff` (`cloud/src/engine/competitorWatch.ts:181`) already computes name/version/rating diffs between snapshots.

**Why it matters:** this is the product's core promise made visible — proving the loop ("ship metadata → see rank move"). It's the highest-leverage feature we can build with **zero new data sources** (Apple has no historical rank API; no backfill possible), and it converts already-collected competitor history from dead weight into the "what they did" half of the story.

## 2. Goal & non-goals

### Goal
- Add a **timeline view (per app, per keyword)** that overlays the rank trajectory with **annotation markers** at points where we *observed* a change:
  - **Your approved metadata pushes** (from `derivePushes`, `cloud/src/api/index.ts:1163`) — the terms WE added, with the approval timestamp.
  - **Competitors' visible changes** — name/version/rating diffs between consecutive `competitor_snapshots` rows (via `diff`).
- Add a **"Movers" summary**: which tracked keywords climbed/dropped most over a window, and the nearest observable change that *preceded* each (correlational only).
- Keep the existing honesty posture verbatim: correlational language, no causal claims, explicit "partial observability" disclosure for competitors.

### Non-goals
- **No new data sources, no backfill.** We only annotate history we already have. (Apple has no historical rank API — stated in the UI.)
- **No scraping competitors' subtitle/keyword field** (the #30/#41 public-API blind spot). We see name/version/rating only; the UI must say so.
- **No causal inference / ML.** Attribution stays a time-ordering join.
- **No new push capability, no auto-push.** This is a read-only analytics view.
- **No changes to the cron/digest email** in this issue (the timeline is a dashboard surface; the digest already carries the latest delta).
- **No new persisted tables** beyond an optional index (§4) — annotations are *derived at read time* from existing rows.

## 3. Proposed approach (grounded in real files)

The whole feature is a **pure read-time join** over three already-persisted series, mirroring the PRD-02 pattern (`rankDeltasView` overlays attribution onto deltas without changing the delta numbers — `cloud/src/digest.ts:237`). We add one engine module, one D1 reader, one API route, and one frontend surface.

### 3.1 New engine module: `cloud/src/engine/rankTimeline.ts` (pure, no D1/network)

Mirrors `rankAttribution.ts`'s contract (pure function, caller supplies already-read rows). Two exports:

```ts
export type TimelineAnnotation = {
  at: string;                       // ISO timestamp (push approval OR competitor seen_at)
  kind: "push" | "competitor";
  // push:
  runId?: string;
  addedTerms?: string[];            // from rankAttribution's addedTermsOf, reused
  // competitor:
  competitor?: string;              // NAME only (privacy boundary — never a raw listing)
  changedFields?: Record<string, { from: string; to: string }>; // version/rating/name only
  // human, CORRELATIONAL copy (never causal):
  label: string;                    // e.g. "You added 'stoic' to keywords" / "Calm shipped v5.2"
};

export type KeywordTimeline = {
  keyword: string;
  points: Array<{ rank: number | null; total: number; checked_at: string }>;
  annotations: TimelineAnnotation[];   // sorted by `at`, only those within the points' time span
};

export type Mover = {
  keyword: string;
  from: number | null;
  to: number | null;
  delta: number | null;             // negative = improved (reuse rankAttribution.classify semantics)
  direction: MovementDirection;
  // the nearest annotation that PRECEDED the move (correlational), or null
  precededBy: TimelineAnnotation | null;
  // honesty: competitor observability is partial
  note?: string;                    // e.g. "We see competitors' version/rating, not their keywords."
};

export function buildKeywordTimeline(input: {
  keyword: string;
  rankHistory: RankSnapshotRow[];            // already keyword-filtered, ASC
  pushes: PushInput[];                       // from derivePushes
  competitorChanges: CompetitorChangeEvent[];// from new D1 reader (§3.2), within span
}): KeywordTimeline;

export function buildMovers(input: {
  rankHistory: RankSnapshotRow[];            // all keywords, ASC
  pushes: PushInput[];
  competitorChanges: CompetitorChangeEvent[];
  keywords?: string[];                       // #74-style scoping to currently-targeted set
  window?: number;                           // days; default 30
}): Mover[];                                 // sorted biggest-mover-first (reuse movementWeight)
```

**Reuse, don't reinvent:**
- Push annotations reuse `addedTermsOf` and the time-window logic from `rankAttribution.ts`. To avoid duplication, export the currently-private helpers (`addedTermsOf`, `toMs`, `shortDate`, `classify`, `lastTwoDistinct`) from `rankAttribution.ts` and import them here. The "nearest preceding push that added the keyword" lookup is exactly `findAttribution` (`rankAttribution.ts:232`) — call `attributeRankMovements` for movers and lift its `attributedChange` into `precededBy`.
- Competitor annotations reuse `diff` (`competitorWatch.ts:181`): for each competitor, diff consecutive snapshots ordered by `seen_at`; emit a `TimelineAnnotation` per non-`same` diff. The `label` is built from `WATCH_FIELDS` deltas (`competitorWatch.ts:22`) — **name/version/rating only**, never subtitle/keywords (we don't have them).
- **Correlational copy discipline:** every `label`/`note` string goes through the same blame-scan test that `rankAttribution.spec.ts` runs ("caused"/"because"/"due to"/"thanks to" forbidden). The competitor label is phrased "Calm shipped v5.2 (seen Jun 12)" — an observation, not a cause.

### 3.2 New D1 reader: `getCompetitorHistory` in `cloud/src/d1.ts`

Today only `getLatestCompetitorMap` (`cloud/src/d1.ts:641`) reads competitor snapshots. Add a full-history reader plus a derived change-event helper:

```ts
export async function getCompetitorHistory(
  db: D1Database, appId: string, opts?: { limit?: number },
): Promise<CompetitorSnapshotRow[]>;   // ORDER BY comp_id, seen_at ASC
```

Then compute `CompetitorChangeEvent[]` either in the engine (preferred — keep D1 dumb) by walking consecutive rows per `comp_id` and running `diff`. Index `idx_comp_app` already covers `(app_id, comp_id, ...)` (`schema.sql:104`), so the read is cheap. Consider adding `idx_comp_app_seen ON competitor_snapshots(app_id, comp_id, seen_at)` only if EXPLAIN shows a scan (optional, low priority).

### 3.3 New API route: `GET /apps/:id/timeline`

Register in the route table next to `deltas`/`war-room` (`cloud/src/api/index.ts:1900-1908`):

```ts
if (seg.length === 3 && seg[1] && seg[2] === "timeline" && method === "GET") {
  return json(await appTimeline(env, user.id, seg[1], url), 200, origin);
}
```

`appTimeline` (new handler, modeled on `appDeltas` `cloud/src/api/index.ts:1119`):
1. `requireOwnedApp(env, appId, userId)` — owner scope (same as every app route).
2. `keyword` = `url.searchParams.get("keyword")` or the lead-keyword pick reused from `appRanks` (`cloud/src/api/index.ts:1081-1095`) — factor that picker into a shared helper.
3. `history = getRankHistory(env.DB, appId, { keyword })`; `pushes = derivePushes(env, appId)` (already exists, `cloud/src/api/index.ts:1163`); `competitorChanges` from `getCompetitorHistory` → `diff` walk.
4. Return `buildKeywordTimeline(...)`.
5. Add a sibling `GET /apps/:id/movers?window=30` → `buildMovers(...)`, scoped to `latestRunKeywords` (`cloud/src/api/index.ts:1145`) like `appDeltas` does for #74.

**Privacy/honesty in the response shape:** mirror the war-room boundary (`cloud/src/api/index.ts:1198`) — competitor annotations expose **NAME + the changed watched fields only**, never a raw `Listing`. No ASC data, no `.p8`, nothing beyond what `competitor_snapshots` already holds.

### 3.4 Frontend: annotated timeline + movers card in `cloud/public/app.js`

- **Upgrade `sparkline`** (`cloud/public/app.js:2321`) into (or add alongside) an annotated variant that accepts `{ points, annotations }` and draws vertical marker lines / glyphs at each annotation's `at` (mapped to the nearest point's x via `checked_at`). Reuse the existing inline-SVG approach (`createElementNS`, the `x(i)`/`y(r)` scales). Push markers use a "✦" glyph (matches `DIR_GLYPH.new` `cloud/public/app.js:655`); competitor markers a distinct neutral glyph. Hover/tap shows the `label`.
- In `viewApp` (`cloud/public/app.js:596`) fetch `/timeline` alongside `/ranks` + `/deltas` and render the annotated chart in the existing "Rank trend" card (`cloud/public/app.js:617`). Add a small keyword selector (the targeted-keyword set) so the user can switch the series.
- **Movers card:** a new card listing top climbers/droppers over the window, each with its `precededBy` annotation rendered with the exact correlational copy + a deep-link to the run (push) — reuse the `.dattr`/`↳` styling already in `rankMovementCard` (`cloud/public/app.js:734-743`).
- **Honesty banner (required by issue):** a `faint` caption on the chart/card stating: (a) "History starts when we began tracking — no backfill (Apple has no historical rank API)"; (b) "We see competitors' name/version/rating, not their keywords/subtitle — so 'what they changed' is partial"; (c) "Timing only — we show changes that *preceded* a move, never that they caused it." Place near the existing "Lower is better…" caption (`cloud/public/app.js:620`).
- **Mock parity:** add `/apps/:id/timeline` and `/apps/:id/movers` to `cloud/public/mock.js` next to the existing `/ranks`/`/deltas`/`/war-room` mocks (around `mock.js:1043-1057`) so the E2E suite and demo mode work without a backend.

## 4. Exact files to change + new files

**New files**
- `cloud/src/engine/rankTimeline.ts` — pure engine (`buildKeywordTimeline`, `buildMovers`, types).
- `cloud/src/engine/rankTimeline.spec.ts` — unit tests (colocated, `*.spec.ts`).
- `cloud/tests/e2e/rankTimeline.e2e.ts` — Playwright E2E (mirrors `attribution.e2e.ts`).

**Changed files**
- `cloud/src/engine/rankAttribution.ts` — export the shared helpers (`addedTermsOf`, `toMs`, `shortDate`, `classify`, `lastTwoDistinct`) for reuse. No behavior change.
- `cloud/src/engine/index.ts` — re-export the new `rankTimeline` types/functions (barrel, consistent with existing engine exports).
- `cloud/src/d1.ts` — add `getCompetitorHistory`; add `getCompetitorHistory` + (optional) `CompetitorChangeEvent` derivation. Add a `d1` spec if a query-shape test fits the repo pattern.
- `cloud/src/api/index.ts` — new `appTimeline` + `appMovers` handlers; register `timeline` + `movers` routes (`~:1900`); factor out the lead-keyword picker shared with `appRanks`; update the route-doc comment block (`~:56-60`).
- `cloud/public/app.js` — annotated sparkline, timeline fetch in `viewApp`, movers card, honesty captions.
- `cloud/public/mock.js` — mock `/timeline` + `/movers`.
- `cloud/public/styles.css` — marker glyph + movers-card styles (extend existing `.spark`/`.dattr` rules).
- `cloud/schema.sql` — (optional) `idx_comp_app_seen` only if EXPLAIN justifies it.

## 5. Test plan (TDD, `*.spec.ts`, strong assertions, parameterized)

Follow the repo's TDD order: scaffold stubs → failing tests → implement. Mirror `rankAttribution.spec.ts` fixtures (`snap()`, `push()` helpers).

**Unit — `cloud/src/engine/rankTimeline.spec.ts`** (pure, no D1):
- `buildKeywordTimeline`:
  - Annotations land within the points' time span; an annotation outside the span is dropped.
  - A push annotation appears at the approval timestamp with the exact `addedTerms`.
  - A competitor version bump between two snapshots produces one `competitor` annotation with `changedFields.version = { from, to }` and a label naming the competitor + new version.
  - A competitor `same` diff produces **no** annotation.
  - Annotations are sorted ascending by `at`.
- `buildMovers`:
  - Biggest improver sorts first (reuse `movementWeight` ordering; assert exact order on a fixture with up/down/new/lost/same).
  - `precededBy` is the nearest annotation strictly *before* the move within its window; a push that lands *after* the observed move is never attached (mirror `findAttribution`'s window test).
  - `keywords` scoping drops history-only keywords (the #74 case).
  - `window` clips the considered span.
- **Honesty blame-scan (load-bearing):** parameterized over every produced `label` + `note` across both functions — assert none contains `/caused|because|due to|thanks to|led to|drove/i`. Assert at least one string surfaces the partial-observability disclosure for competitors.
- Edge: empty history → empty timeline / empty movers (no throw); single-snapshot keyword → no movers entry, timeline renders the one point.

**Unit — `rankAttribution.ts` export change:** existing `rankAttribution.spec.ts` must still pass unchanged (proves the helper extraction is behavior-preserving).

**E2E — `cloud/tests/e2e/rankTimeline.e2e.ts`** (Playwright vs mock, like `attribution.e2e.ts:1`):
- Seed: connect app, run-ASC, **approve** a push (reuse `seedApprovedPush` pattern), seed a competitor version change across two passes, re-check ranks.
- Assert the rank-trend chart renders annotation markers; hovering a push marker shows correlational copy ("You added 'stoic'…"), and it deep-links to the run.
- Assert the Movers card lists the moved keyword with its preceding annotation.
- **Honesty E2E:** assert the page contains the three disclosure captions and that **no** rendered annotation/mover string matches causal language.

**Run gates before any commit (user rule):** lint, typecheck, `vitest run`, and the Playwright e2e — all green.

## 6. Honesty & security considerations

- **Never present unseen data as measured.** Competitor annotations are built *only* from `competitor_snapshots` fields we actually captured (name/version/rating). The UI must state explicitly that subtitle/keywords are **not observed** (the #30/#41 blind spot). No inferred or fabricated competitor metadata.
- **No backfill, no invented history.** The timeline starts at the first real snapshot; a sparse series stays sparse. We never interpolate a rank we didn't check (the existing `sparkline` already plots `null` ranks as `200`+ for layout but labels them "200+", `cloud/public/app.js:2353` — keep that honesty).
- **Correlational, never causal.** All copy reads "after / preceded / we observed," enforced by the blame-scan test across every string. Reuse `rankAttribution.ts`'s discipline verbatim.
- **`.p8` never persisted, never read here.** This feature touches only `rank_snapshots`, `competitor_snapshots`, runs' `reasoning_json` (proposed/current copy), and approval timestamps. No ASC credential path is involved. `derivePushes` already reads only the terms WE proposed — the privacy boundary documented at `cloud/src/api/index.ts:1124-1126`.
- **Agent never auto-pushes.** This is a strictly read-only analytics route (`GET` only, no DB writes, no outward calls). It cannot trigger a push; it surfaces history. The human-gate posture (`decideRun` `cloud/src/api/index.ts:1301`, "approved ≠ shipped") is untouched.
- **Owner-scoped + privacy boundary.** Every route calls `requireOwnedApp`; the response exposes competitor NAME + changed watched fields only — never a raw `Listing`, matching the war-room boundary (`cloud/src/api/index.ts:1198`).

## 7. Risks & rollout

- **Read cost / payload size.** `getCompetitorHistory` + `getRankHistory` over a long-lived app could be large. Mitigate with the existing `limit` (default 500, `cloud/src/d1.ts:612`) and a `window` clip in `buildMovers`. Cap competitor history similarly. Low risk — existing indexes cover both reads.
- **Marker crowding.** Many pushes/competitor changes on a short series can clutter the SVG. Mitigate by clustering same-timestamp annotations into one marker with a combined tooltip; cap visible markers and "+N more."
- **Helper-extraction regression** in `rankAttribution.ts`. Mitigated by keeping its spec green (behavior-preserving export only).
- **Over-claiming via competitor annotations.** Strictly bounded to watched fields + blame-scan test; the partial-observability caption is mandatory.
- **Rollout:** purely additive (new routes, new card, mock parity). No migration required (no new table; optional index is `IF NOT EXISTS`). Ship behind the normal deploy; no feature flag needed since it degrades gracefully (empty history → "No rank history yet," matching `sparkline` `cloud/public/app.js:2323`). Backwards-compatible: existing `/ranks` and `/deltas` untouched.

## 8. Effort & decision needed

- **Effort: M.** One pure engine module (+ spec), one D1 reader, two thin API handlers reusing `derivePushes`/`getRankHistory`/`diff`, an SVG annotation layer, a movers card, mock parity, and E2E. No new tables, no new data source, heavy reuse of PRD-02 machinery.
- **Owner DECISION required before building (one item):** **Surface scope.** Do we (a) *enhance the existing "Rank trend" card in place* (annotate the current single-keyword sparkline + add a Movers card) — smallest, ships fastest, recommended — or (b) build a *dedicated full-width Timeline view* (multi-keyword switcher, wider window controls, its own route in the SPA)? This changes the frontend footprint materially (S vs M on the UI side) and whether we add a nav entry. Everything else (engine, D1, API, honesty posture) is the same either way. **Recommendation: ship (a) first** as the T1 increment; (b) becomes a fast follow if the annotated card proves the value.
- Secondary (non-blocking) call: default Movers `window` (recommend 30 days) and whether to scope movers to `latestRunKeywords` (recommend yes, consistent with #74 at `cloud/src/api/index.ts:1128`).
