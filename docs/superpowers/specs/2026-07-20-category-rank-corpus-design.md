# Category rank+metadata corpus (#63)

## Goal

Start recording, daily, a BROAD category-tagged sample of rank + VISIBLE metadata for the top-N apps per seed keyword — not just customer apps. Over months this compounds into a "movers & shakers" dataset the paid players spent years scraping. The earlier collection starts, the more history accrues, so the point is to ship the collector now (gated) and let it bank history.

## Decision (from scoping)

**Engine + schema + opt-in cron, conservative caps, OFF by default.** Build the table, the collection engine, and the cron wiring behind `flagOn(env.CATEGORY_CORPUS_ENABLED)` (default off). The owner reviews iTunes ToS + egress/cost and flips the flag when ready. Nothing collects until then. Hard caps keep the first-enabled footprint small.

## State before this work (verified)

- The daily cron exists (`cloud/src/cron/snapshot.ts` `runDailySnapshot`/`handleDailySnapshot`), but it only snapshots **customer apps' own keyword ranks** (`persistRankSnapshots`, app-FK-scoped). No broad category corpus.
- `rank_snapshots` is `REFERENCES apps(id)` — corpus apps aren't customer apps, so a **new table with no app FK** is needed (modeled on `play_rank_snapshots`, `schema.sql:145`).
- iTunes search already returns everything we need per app — `ItunesResult` (`cloud/src/engine/itunes.ts:133`) carries `bundleId`, `trackName`, `version`, `description`, `averageUserRating`, `userRatingCount`, `primaryGenreId`/`primaryGenreName` (**the category tag, free**). `fetchJson`/`buildUrl` + `ITUNES_SEARCH_URL`/`ITUNES_MAX_LIMIT` are the fetch path; prod egress routes via TinyFish through `fetchForEnv(env)`.
- Only 2 of Cloudflare's max-5 crons are used (`"0 * * * *"`, `"0 8 * * *"`) — room to piggyback on the daily trigger (the `runAnalyticsIngest` precedent) rather than add a 3rd.
- Flag idiom: `flagOn(env.X)` (`cron/analyticsIngest.ts:29`), env vars optional strings on `Env`, default-off because undefined.

## Honesty caveat (same as rank T1)

We can only see VISIBLE fields. **Subtitle and the keyword field are NOT in the iTunes payload** — the corpus records name/version/description/rating/category/rank only, and every downstream use (incl. #64) must state that the picture is partial. A `rank` we couldn't read is stored as `null` (a real "not in top-N"), never a fake 0 — same posture as `rank_snapshots`.

## Component 1 — the corpus table

New `corpus_snapshots` in `cloud/schema.sql` (+ a documented inline `wrangler d1 execute` migration line, matching the repo pattern). **No app FK** — these are arbitrary store apps.

```sql
CREATE TABLE IF NOT EXISTS corpus_snapshots (
  id            TEXT PRIMARY KEY,                 -- uuid
  seed_keyword  TEXT NOT NULL,                    -- the search term this sample came from
  country       TEXT NOT NULL DEFAULT '',         -- lowercased storefront
  bundle_id     TEXT NOT NULL,                    -- the observed app (NOT a customer app; no FK)
  track_id      INTEGER,                          -- iTunes trackId
  name          TEXT NOT NULL DEFAULT '',
  category_id   TEXT NOT NULL DEFAULT '',         -- primaryGenreId (e.g. "6012")
  category_name TEXT NOT NULL DEFAULT '',
  rank          INTEGER,                          -- position in the seed's search results (1-based); NULL = beyond cap
  version       TEXT NOT NULL DEFAULT '',
  rating        REAL,                             -- averageUserRating; NULL when absent
  rating_count  INTEGER,                          -- userRatingCount; NULL when absent
  description   TEXT NOT NULL DEFAULT '',         -- VISIBLE description (subtitle/keywords NOT available)
  checked_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corpus_seed ON corpus_snapshots(seed_keyword, country, checked_at);
CREATE INDEX IF NOT EXISTS idx_corpus_bundle ON corpus_snapshots(bundle_id, checked_at);
```

`persistCorpusSnapshots(db, rows: CorpusRow[])` in `d1.ts` — batched insert (like `persistRankSnapshots`), one row per observed app; `uuid()`/`now()`; a `null` rank persists honestly.

## Component 2 — the collection engine (pure, unit-tested)

`cloud/src/engine/corpusCollect.ts`:

```ts
export type CorpusObservation = {
  seedKeyword: string; country: string;
  bundleId: string; trackId?: number; name: string;
  categoryId: string; categoryName: string;
  rank: number | null; version: string;
  rating: number | null; ratingCount: number | null;
  description: string;
};

// Pure mapper: one seed's raw iTunes results → capped, cleaned observations.
export function observationsFromResults(
  seedKeyword: string, country: string,
  results: ItunesResult[], opts: { topN: number },
): CorpusObservation[];

// Orchestrator over the injected FetchFn: search each seed, map, honor caps.
export async function collectCorpus(
  fetchFn: FetchFn,
  seeds: string[],
  opts: { country?: string; topN?: number; pauseMs?: number },
): Promise<CorpusObservation[]>;
```

- `observationsFromResults` is the pure core (unit-tested with fixture `ItunesResult[]`): assigns 1-based `rank` by result order, caps at `topN`, drops results with no `bundleId`, carries category tag + visible metadata, coerces missing rating/version to null/"".
- `collectCorpus` searches each seed via `fetchJson(fetchFn, buildUrl(ITUNES_SEARCH_URL, { term, country, entity:"software", limit }))`, maps, and paces between calls (reuses the `ranksFor` pause idiom). Per-seed failure is isolated — one bad seed never aborts the run.

### Conservative caps (the OFF-by-default footprint)

- A **small fixed seed set** shipped in the module (e.g. 8–12 broad category seeds), not user-driven, so enabling can't fan out unboundedly.
- `topN` default **20** (not the 200 iTunes max) — enough for a movers dataset, a fraction of the egress.
- Runs at most **once daily** (piggybacked on the existing daily cron), country default `us`.
- These are the initial safe defaults; the owner can widen them later with eyes open. The cron logs the exact seed×topN it collected so the footprint is never silent.

## Component 3 — cron wiring (gated)

Piggyback on `handleDailySnapshot` (`cron/snapshot.ts`), after the existing snapshot + analytics-ingest steps (the `runAnalyticsIngest` precedent):

```ts
if (flagOn(env.CATEGORY_CORPUS_ENABLED)) {
  await runCorpusCollection(env);   // new cron/corpusCollection.ts
}
```

`runCorpusCollection(env)` (thin I/O shell): `fetchForEnv(env)` → `collectCorpus(fetchFn, CORPUS_SEEDS, { country, topN })` → `persistCorpusSnapshots(env.DB, rows)`; returns a small report (`seedsProcessed`, `rowsPersisted`, `perSeed`). Add `CATEGORY_CORPUS_ENABLED?: string` to `Env`, documented "Unset → corpus collection is inert (default)."

## Retention (stated, minimal now)

Time-series growth is real. The schema is retention-ready (indexed by `checked_at`); a rollup/prune job is a follow-up, not this PR. This PR documents the growth shape (rows/day ≈ seeds × topN) in the schema comment so it's not a surprise. With the conservative caps (≈10 seeds × 20) that's ≈200 rows/day — trivial; the prune matters only if the owner later widens the caps.

## Testing

- `corpusCollect.spec.ts` — `observationsFromResults`: rank ordering, topN cap, drops no-bundleId, category tag carried, null rating/version coercion, empty results → []. `collectCorpus` with a fake `FetchFn`: multi-seed aggregation, per-seed failure isolation, pacing count.
- `d1.corpusSnapshotsSchema.spec.ts` — runs the `corpus_snapshots` DDL against a real D1 and round-trips `persistCorpusSnapshots` (incl. a null-rank row), matching the repo's `*Schema.spec.ts` pattern.
- `corpusCollection.spec.ts` (cron) — `vi.mock` of d1/fetchAdapter (the `snapshot.spec.ts` pattern): flag OFF → collects nothing; flag ON → calls collect+persist; a seed error doesn't abort.

## Out of scope (explicit)

- The pattern-mining/analysis over the corpus — that's #64 (built next, reads this table).
- Any analysis UI.
- Retention rollup/prune job — follow-up once caps are widened.
- Enabling collection in prod — an owner action (set `CATEGORY_CORPUS_ENABLED` after ToS/cost review).
