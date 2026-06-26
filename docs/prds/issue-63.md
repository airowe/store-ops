# PRD — Rank Intelligence T2: Category Rank+Metadata Corpus via Cron

**GitHub issue:** #63 — "Rank intelligence T2: build a category rank+metadata corpus via the cron (the compounding data moat)"
**Author:** airowe · **State:** open
**Owner DECISION REQUIRED before build:** YES (ToS + cost gate — see §7 and §9)

---

## 1. Problem & context

### What's missing
ShipASO records time-series only for **apps a customer has connected**. The cron (`runWeeklySweep` in `cloud/src/cron/scheduled.ts:103`) walks `listAllApps` and, per app, runs the full agent and appends `rank_snapshots` + `competitor_snapshots` scoped to that one app (`persistRun` in `cloud/src/d1.ts:427`, snapshot inserts at `d1.ts:496-517`). Both snapshot tables are keyed by `app_id` with a foreign key + `ON DELETE CASCADE` to `apps` (`cloud/schema.sql:83-104`). There is **no record of the broader category** — the apps a customer does *not* own but competes against, and the ones that climbed.

The paid incumbents (Sensor Tower / AppTweak / data.ai) have multi-year cross-app rank panels because they scraped the stores daily for years. That history **cannot be bought retroactively** — but it compounds, so the value of starting is highest the earlier we start.

### Why it matters
The product's existing "rank intelligence T1" surfaces — winnability opportunities (`rankOpportunities`, wired in `api/index.ts:333 attachOpportunities`) and the head-to-head war room (`api/index.ts:1201 warRoom`) — can only reason about *the customer's own* tracked keywords plus *live* spot-checks of named competitors. They cannot answer the compounding question the issue frames:

> "Which apps climbed for 'meal planner' last quarter, and what visible metadata changes preceded the climb?"

To answer that **at scale and historically**, we must record the category ourselves, starting now. Every cron day that passes without this is a day of history we can never recover.

### The key technical enabler (already in the codebase)
A single iTunes Search call already returns the **entire ranked `results[]`**, and each element is an `ItunesResult` carrying the visible metadata we need: `trackId`, `trackName`, `version`, `formattedPrice`/`price`, `averageUserRating`, `userRatingCount`, `genres`, `screenshotUrls` (`cloud/src/engine/itunes.ts:132-148`). Today `rankFor` (`cloud/src/engine/rankCheck.ts:38`) fetches that exact payload and **throws away everything except the index of the customer's `bundleId`**. The corpus is, mechanically, *"keep the rest of the array we already fetched."* That makes T2 cheap **per keyword** (one Search call captures rank order + metadata for the whole top-N) — the cost question (§7) is about **how many keywords × how often**, not per-call complexity.

---

## 2. Goal & non-goals

### Goal
Persist a **category-tagged, time-series corpus** of rank position + visible metadata for the top-N apps per seed keyword, collected by the cron, **independent of any customer's connected apps**, so that over months it becomes a "movers & shakers" dataset: which apps climbed for a term, and what visible changes preceded the move.

**Definition of done (Phase 1 — minimal collection):**
1. A new D1 table `corpus_snapshots` (category/keyword-tagged, NOT FK'd to `apps`) and a seed-keyword config exist.
2. A pure, unit-tested engine module `categoryCorpus.ts` turns one Search `results[]` into normalized corpus rows.
3. A cron pass `runCorpusSweep` collects the corpus on a **budgeted, opt-in-by-config** cadence, isolated from the customer sweep (one bad keyword never aborts the batch — same contract as `ranksFor`, `rankCheck.ts:75`).
4. Retention/rollup is planned and enforced (a prune step) so D1 growth is bounded.
5. Everything is gated behind a config flag + an explicit owner DECISION (ToS/cost), defaulting **OFF**.

### Non-goals (explicitly out of scope for this PRD)
- **No analysis UI** ("movers & shakers" dashboard) — the issue says start collection sooner, UI later. Phase 2.
- **No subtitle/keyword-field visibility** — iTunes never exposes a competitor's private keyword field (same honesty caveat as T1, see `competitorWatch.ts:6-10`). We record VISIBLE fields only.
- **No daily cadence at launch** — start conservative (weekly, same trigger) until the budget is measured.
- **No third-party paid data ingestion** — this is *our own* recorded corpus.
- **No change to the customer sweep's behavior, thresholds, or approval gate.** The corpus pass is additive and side-effect-free w.r.t. customer runs.

---

## 3. Proposed approach (grounded in real files)

### 3a. Reuse the fetch we already make
The corpus is captured by the same iTunes Search call `rankFor` makes. Add a sibling **`searchCorpus`** in a new `cloud/src/engine/categoryCorpus.ts` that:
- Calls `fetchJson(fetchFn, buildUrl(ITUNES_SEARCH_URL, { term, country, entity: "software", limit }))` (identical to `rankCheck.ts:45-51`).
- Maps **every** result in `results[]` (capped at `limit`, top-N) to a `CorpusRow`, capturing `rank = i+1` and the visible fields from `ItunesResult`. Reuses the exact price/rating formatting already in `competitorWatch.ts:50-67` (`resultToListing`) so corpus metadata matches what the war room/competitor watch show.
- Never throws for one bad keyword — returns `{ keyword, error }` per the `ranksFor` resilience contract (`rankCheck.ts:88-100`).

Pure + injectable `FetchFn` so it unit-tests with no runtime (matches the whole-engine convention, `engine/index.ts:1-5`).

### 3b. Route egress through the existing transport
The corpus sweep uses `fetchForEnv(env)` (`cloud/src/fetchAdapter.ts:34`) — the same adapter that selects TinyFish (`tinyfishFetch.ts:82`) in production to dodge Apple's datacenter-IP 403, and falls back to direct fetch locally. **No new egress path, no new secret.** This means corpus calls share the TinyFish meter — central to the cost decision (§7).

### 3c. New persistence shape (NOT under `apps`)
The corpus is category-scoped, not app-scoped, so it must NOT live in `rank_snapshots`/`competitor_snapshots` (those FK to `apps` with `ON DELETE CASCADE`, `schema.sql:85,97` — disconnecting an app would wipe corpus history, which is wrong). Add `corpus_snapshots` keyed by `(category, keyword, track_id, captured_at)` with no app FK. New d1 helpers in `cloud/src/d1.ts`:
- `persistCorpusSnapshot(db, rows)` — batched insert mirroring the `db.batch(stmts)` pattern at `d1.ts:519`.
- `getCorpusMovers(db, { keyword, since })` — read for Phase 2 (added now, thin, tested).
- `pruneCorpus(db, { retainDays })` — retention enforcement.

### 3d. New cron pass, isolated from the customer sweep
Add `runCorpusSweep(env)` in `cloud/src/cron/scheduled.ts` alongside `runWeeklySweep`. `handleScheduled` (`scheduled.ts:240`) calls it **after** the customer sweep + digests, wrapped in `.catch()` so a corpus failure never affects customer autonomy (same isolation posture as the digest pass at `scheduled.ts:242`). It:
1. Short-circuits to a no-op + log when the corpus flag is unset (default OFF — see §7).
2. Reads the seed-keyword/category config.
3. Enforces a **hard per-sweep budget cap** (max keywords × top-N) before fetching — the cost guardrail.
4. Calls `searchCorpus` per seed keyword via `fetchForEnv(env)`, with the same polite `pauseMs` spacing `ranksFor` uses (`rankCheck.ts:101`).
5. `persistCorpusSnapshot` the rows, then `pruneCorpus`.
6. Returns a `CorpusReport` (keywords swept, rows written, rows pruned, per-keyword errors) for logging/tests — mirroring `CronReport` (`scheduled.ts:80`).

### 3e. Seed config
A static, versioned `cloud/src/cron/corpusSeeds.ts` exporting `CORPUS_SEEDS: Array<{ category: string; keywords: string[] }>` (e.g. `{ category: "Health & Fitness", keywords: ["meal planner", "meditation", ...] }`). Static file (not D1) keeps it reviewable in PRs and trivially testable; it's the throttle that bounds cost.

### 3f. Manual trigger for testing (optional, recommended)
The current cron has no debug HTTP route. Add an **owner-gated** `POST /admin/corpus-sweep` to `handleApi` (router at `api/index.ts:1779+`) that runs one `runCorpusSweep` and returns the `CorpusReport`, so the sweep can be exercised against live data without waiting for the cron. Gated by an env secret check (not a normal user session) so it can't be invoked by customers.

---

## 4. Exact files to change + new files

### New files
| Path | Purpose |
|---|---|
| `cloud/src/engine/categoryCorpus.ts` | Pure `searchCorpus(fetchFn, keyword, opts)` → `CorpusRow[]`; reuses `buildUrl`/`fetchJson`/`ITUNES_SEARCH_URL` and the `resultToListing` formatting. Never throws per keyword. |
| `cloud/src/engine/categoryCorpus.spec.ts` | Unit tests (mock `FetchFn`): rank indexing, metadata mapping, top-N cap, per-keyword error isolation, empty results. |
| `cloud/src/cron/corpusSeeds.ts` | `CORPUS_SEEDS` static config (categories → seed keywords) + `corpusBudget()` cap. |
| `cloud/src/cron/corpusSweep.spec.ts` | Tests for `runCorpusSweep` (mock fetch + in-mem D1 or stubbed d1 helpers): flag-off no-op, budget cap enforced, per-keyword error isolation, prune called. |
| `cloud/src/d1.corpus.spec.ts` | Tests for `persistCorpusSnapshot` / `getCorpusMovers` / `pruneCorpus`. |

### Changed files
| Path | Change |
|---|---|
| `cloud/schema.sql` | Add `corpus_snapshots` table (no `apps` FK) + index on `(category, keyword, captured_at)` and `(keyword, track_id, captured_at)`. Include the inline `ALTER`/migration comment block in the repo's house style (see `schema.sql:37-46`). |
| `cloud/src/d1.ts` | Add `CorpusRow` type, `persistCorpusSnapshot`, `getCorpusMovers`, `pruneCorpus`. |
| `cloud/src/cron/scheduled.ts` | Add `runCorpusSweep(env)` + `CorpusReport` type; call it from `handleScheduled` after digests, inside `.catch()`. |
| `cloud/src/engine/index.ts` | Re-export `searchCorpus` + `CorpusRow` (engine public surface convention, `index.ts:16`). |
| `cloud/src/index.ts` | Add `CORPUS_ENABLED?: string` (+ optional `CORPUS_ADMIN_TOKEN?: string`) to the `Env` type (`index.ts:15-58`). |
| `cloud/wrangler.toml` | Document `CORPUS_ENABLED` under `[vars]` (default unset/OFF) and the admin token under secrets, with the ToS/cost caveat in the comment. **Do not change `crons` cadence in Phase 1** — corpus rides the existing `0 9 * * 1` trigger (`wrangler.toml:40`). |
| `cloud/src/api/index.ts` | (Optional, §3f) Add owner-gated `POST /admin/corpus-sweep` route. |

### Proposed `corpus_snapshots` schema
```sql
-- ── corpus_snapshots ─────────────────────────────────────────────────────────
-- Category-scoped rank + VISIBLE metadata for the top-N apps per seed keyword.
-- Independent of customer apps: NO app_id FK (so disconnecting an app never
-- prunes the corpus). The compounding cross-app panel (issue #63). VISIBLE fields
-- only (iTunes exposes no competitor keyword/subtitle field) — same honesty caveat
-- as competitor_snapshots.
CREATE TABLE IF NOT EXISTS corpus_snapshots (
  id            TEXT PRIMARY KEY,                 -- uuid
  category      TEXT NOT NULL,                    -- seed category tag (corpusSeeds.ts)
  keyword       TEXT NOT NULL,                    -- seed term searched
  country       TEXT NOT NULL DEFAULT 'US',
  rank          INTEGER NOT NULL,                 -- 1-based position in results[]
  track_id      TEXT NOT NULL,                    -- App Store trackId (stable app key)
  name          TEXT NOT NULL DEFAULT '',
  version       TEXT NOT NULL DEFAULT '',
  price         TEXT NOT NULL DEFAULT '',
  rating        TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '',
  captured_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corpus_kw   ON corpus_snapshots(keyword, captured_at);
CREATE INDEX IF NOT EXISTS idx_corpus_cat  ON corpus_snapshots(category, keyword, captured_at);
CREATE INDEX IF NOT EXISTS idx_corpus_app  ON corpus_snapshots(track_id, keyword, captured_at);
```

---

## 5. Test plan (TDD, `*.spec.ts`, colocated)

Follow the repo's TDD flow (scaffold stub → failing test → implement) and `vitest` node env for pure engine specs (`vitest.config.ts`). Strong, parameterized assertions; no unexplained literals.

### Unit — `categoryCorpus.spec.ts` (pure, mock `FetchFn`)
- Maps a fixture `results[]` of 5 apps → 5 `CorpusRow`s with `rank` 1..5 in order.
- Captures visible metadata correctly: `formattedPrice`→`price`, `averageUserRating`+`userRatingCount`→`rating` string (assert exact formatting matches `competitorWatch.ts:50-67`), `genres.join(", ")`.
- `limit` caps the corpus at top-N even when `results.length` exceeds it.
- Empty `results[]` → `[]`, no throw.
- A fetch that rejects → a single `{ keyword, error }` row, batch not aborted (mirror `rankCheck.spec.ts` resilience cases).

### Unit — `d1.corpus.spec.ts`
- `persistCorpusSnapshot` issues one batched insert per row (assert `db.batch` called with N statements).
- `pruneCorpus({ retainDays })` deletes only rows older than the cutoff.
- `getCorpusMovers` returns rows for a keyword since a timestamp (shape contract for Phase 2).

### Unit — `corpusSweep.spec.ts`
- Flag OFF (`CORPUS_ENABLED` unset) → no fetch, no write, returns a zeroed report (assert `fetchFn` never called).
- Budget cap: with a seed config exceeding `corpusBudget()`, the sweep fetches **at most** the cap (assert call count) — the cost guardrail is enforced in code, not just docs.
- One keyword's fetch throwing does NOT abort the sweep; its error is captured in the report (isolation contract).
- `pruneCorpus` is invoked after persistence.

### E2E (`@cloudflare/vitest-pool-workers` / playwright, per `cloud/tests/`)
- Migration applies cleanly (`npm run db:migrate:local`) and `corpus_snapshots` exists.
- (If admin route built) `POST /admin/corpus-sweep` with a valid admin token returns a `CorpusReport`; without it → 403. Assert it writes rows and that **disconnecting a customer app does not delete corpus rows** (proves the no-FK design).

### Regression
- `scheduled.spec.ts` (existing) still passes — `evaluateThreshold` and the customer sweep are untouched. Add one case asserting `handleScheduled` still completes when `runCorpusSweep` throws (isolation via `.catch()`).

---

## 6. Quality gates
Before any commit (per user workflow standards): `npm test` (vitest), typecheck (`tsc`, strict mode), lint. No `// TODO` — file follow-ups as issues (Phase 2 UI, daily-cadence cost review). Conventional Commit (e.g. `feat(cron): category rank+metadata corpus collection`). **Agent never auto-commits or auto-pushes** — owner approval required.

---

## 7. Honesty & security considerations (core product value)

1. **Never present unseen data as measured.** The corpus records ONLY iTunes-visible fields (name, version, price, rating, genres, screenshot URLs) — exactly the honesty boundary `competitorWatch.ts:6-10` already documents. A future "movers & shakers" UI MUST label these as *visible changes observed*, and any rank we did not actually capture in a given window stays **null/absent**, never interpolated. This mirrors the war-room contract: "a competitor we can't resolve comes back `null` — honest 'we didn't check', never a guess" (`api/index.ts:1196-1198`).
2. **No correlation stated as causation.** "Apps that climbed + visible changes that preceded it" is **correlational**. Phase 2 copy must hedge exactly like the existing attribution does ("after you added 'stoic'…" — correlational, `api/index.ts:1124-1127`). The PRD's job is to make sure the *data* never encodes a causal claim.
3. **Never persist the `.p8`.** Not applicable directly (the corpus uses no ASC credentials — it's public iTunes only), and this PRD introduces no credential. The ASC ephemeral-key posture (`api/index.ts:909-913, 1033-1043`) is untouched. Explicitly: **do not** thread any customer `.p8` into corpus collection.
4. **Agent NEVER auto-pushes.** The corpus sweep is **read-and-record only** — it makes no proposals, opens no runs, and is fully outside the approval gate. It cannot reach App Store Connect. This is strictly weaker (safer) than `runWeeklySweep`, which already "only PREPARES; the irreversible step stays gated behind the human approval" (`scheduled.ts:19-20`).
5. **ToS / acceptable-use.** iTunes Search/Lookup are already used for the product, but **broad systematic collection is a different scale and a different ToS question.** This requires an explicit owner sign-off (§9) before enabling. The code ships **OFF by default** (flag unset) so merging the plumbing cannot accidentally start scraping.
6. **Egress/cost is metered.** Corpus calls go through TinyFish in prod (`fetchAdapter.ts:35-37`), so they bill against the same meter as customer runs. The hard per-sweep budget cap (`corpusBudget()`) is enforced **in code** before any fetch — a config typo can't blow the budget.
7. **Admin route hardening.** If `/admin/corpus-sweep` is built, gate it on a dedicated secret (`CORPUS_ADMIN_TOKEN`), not a customer session, and never expose corpus internals to customer-facing routes in Phase 1.

---

## 8. Risks & rollout

| Risk | Mitigation |
|---|---|
| **ToS violation at scale** | Ship OFF by default; require owner DECISION; start with a tiny seed set (weekly, low top-N); document acceptable-use review in the PR. |
| **Cost blowout (TinyFish egress)** | Hard `corpusBudget()` cap enforced pre-fetch + unit-tested; start weekly on the existing trigger; measure real spend before any daily cadence (separate issue). |
| **D1 storage growth (time-series)** | `pruneCorpus(retainDays)` runs every sweep; index design supports cheap pruning; consider monthly rollups in Phase 2 (raw → aggregated movers). |
| **Corpus failure harming customer autonomy** | `runCorpusSweep` runs last in `handleScheduled`, wrapped in `.catch()` (same as the digest pass); per-keyword errors isolated like `ranksFor`. |
| **Disconnect wiping history** | `corpus_snapshots` has no `apps` FK (deliberate); E2E test asserts disconnect leaves corpus intact. |
| **Apple 403 / rate limits** | Reuses the existing TinyFish transport + `RETRY_STATUS` backoff (`itunes.ts:97-130`); polite `pauseMs` spacing. |

### Rollout
1. Merge plumbing **OFF** (flag unset) — zero behavior change, full test coverage.
2. Owner makes the ToS/cost DECISION.
3. Enable on a **minimal** seed set (a handful of keywords, weekly) on the existing cron trigger.
4. Watch TinyFish spend + D1 row growth for 2–4 weeks.
5. Only then consider expanding the seed set or moving to a more frequent dedicated cron — as a **separate** issue with its own cost sign-off.
6. Phase 2 (separate issue): "movers & shakers" read API + UI, with honesty-labeled correlational framing.

---

## 9. Effort estimate & decision gate

- **Effort: M** for Phase 1 minimal collection (one pure engine module + spec, one D1 table + 3 helpers + spec, one cron pass + spec, config file, Env/wrangler wiring). The optional admin route adds a little. The full "movers & shakers" analysis UI is a **separate L** (Phase 2, explicitly out of scope here).
- **Needs a product DECISION from the owner before building: YES.** Two coupled gates the owner must clear first:
  1. **ToS / acceptable-use:** is broad, systematic, recurring collection of category rank+metadata acceptable under the iTunes Search/Lookup terms at the intended scale? (Per-call we already do this; the new thing is *scale + recurrence + breadth*.)
  2. **Cost envelope:** what monthly TinyFish egress + D1 storage budget is approved? That number sets `corpusBudget()` (keywords × top-N × cadence) and the seed-set size.

  Recommendation: approve a **deliberately tiny** Phase-1 budget (a few keywords, weekly) so history starts compounding *now* (the issue's core point — "the EARLIER it starts, the more history it accrues") while the ToS and cost questions are validated cheaply with real data, before any expansion.

