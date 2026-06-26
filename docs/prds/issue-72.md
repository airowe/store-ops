# PRD — Competitor Discovery & Collection (#72)

**Owner:** product engineering · **Status:** Draft for owner decision · **Effort:** **M** (one decision gate, then mostly mechanical) · **Needs a product DECISION before building:** **Yes** — pick option A/B/C (see §9).

---

## 1. Problem & context

The product promises competitor watching but never collects competitors, so the whole "watch competitors" loop runs on an **empty list**.

Verified in the code:

- **No persistent competitor set exists.** All three run paths read competitors only from the untrusted request body and default to `[]`:
  - connect: `cloud/src/api/index.ts:798` — `if (body.competitors) overrides.competitors = body.competitors;`
  - manual run: `cloud/src/api/index.ts:872`
  - ASC run: `cloud/src/api/index.ts:967`
  - and `buildAppInput` coalesces to empty: `cloud/src/api/runConfig.ts:252` — `competitors: overrides.competitors ?? [],`
- **The dashboard never sends `body.competitors`.** There is no competitor input anywhere in `cloud/public/app.js` (the connect/run flows post only `{bundle_id, name}` / keyword+ASC fields). The war-room selector is fed exclusively by `comp.listings` (`cloud/public/app.js:1814`: `var available = (comp.listings || []).map(...)`), which is always empty.
- **The cron passes nothing either.** `cloud/src/cron/scheduled.ts:129` builds input with no `competitors` override; only `previousCompetitors` (the diff baseline) is threaded.
- **`previousCompetitors` is a baseline, not a source list.** `getLatestCompetitorMap` (`cloud/src/d1.ts:641`) returns the last snapshot keyed by `comp_id` for *diffing*, but the engine only **looks up** apps in `input.competitors` (`cloud/src/engine/agent.ts:237-247`). So even after a snapshot is written once, nothing re-feeds those ids into the next run's lookup list. Collection has no closed loop.

**Result:** every run shows a competitor step driven by an empty set. The honesty risk this raises is the same class as #65/#69 — asserting an action we didn't perform.

**Stopgap D is already partly shipped** (do not redo it):
- The run-step copy is already honest: `cloud/public/app.js:1470-1475` only says "Watched competitors" when `comp.changes`/`comp.listings` is non-empty, else "No competitors added yet."
- The header was already softened to "(and any competitors you add)" — `cloud/public/app.js:426`.

So the copy no longer overclaims, but the **promised capability still does not exist**: there is no way for a user (or the agent) to ever make that set non-empty. This issue is about building the actual collection.

**Why it matters:** competitor watch + the keyword-gap engine + the war room are three of the product's headline surfaces, and all three are dead without a competitor set:
- keyword gaps fuse competitor listings (`cloud/src/engine/agent.ts:289-297`, `findKeywordGaps({... competitors: listings})`) → no listings ⇒ no gaps.
- war room offers only `comp.listings` names → no chips, empty grid.
- cron threshold "competitor movement" (`cloud/src/cron/scheduled.ts:68-75`) can never fire.

---

## 2. Goal & non-goals

**Goal:** give every connected app a real, persisted competitor set that flows into every run path (connect, manual, ASC, cron), so competitor watch / keyword gaps / war room operate on actual data — without ever presenting unseen or guessed data as measured.

**In scope (recommended Option C — hybrid):**
1. A persisted, per-app **tracked competitor set** (new table) — the source of truth for what every run looks up.
2. **Auto-discovery** of *candidate* competitors per app via iTunes Search (genre + the app's own tracked keywords), producing trackIds with provenance.
3. A **confirm/edit UI** on the app page: candidates are shown as *suggested* (clearly unconfirmed), the user confirms/removes/adds; only the confirmed set is watched.
4. Wire the confirmed set into all run paths + cron so `overrides.competitors` is populated from storage, not just the request body.

**Non-goals:**
- No scraping of competitors' private keyword fields (iTunes never exposes them; `competitorWatch.ts:6-7` is explicit). We track only the visible listing fields already in `WATCH_FIELDS`.
- No new paid data source / no fabricated volume/difficulty for competitor keywords.
- No automatic *confirmation* — discovery proposes, the human confirms (honesty: a discovered candidate is a guess until confirmed).
- No change to the approval-gate / push model. The agent still never pushes.
- No Google Play competitor discovery this pass (iTunes only, matching the existing engine).

---

## 3. Proposed approach (grounded in real files)

### 3.1 Storage — the missing source of truth
`competitor_snapshots` (`cloud/schema.sql:95`) is a **time-series of diff observations**, not a tracked set, and it only gets rows for competitors we already looked up — circular. Add a dedicated set table:

```sql
-- cloud/schema.sql (new table, after competitor_snapshots)
CREATE TABLE IF NOT EXISTS tracked_competitors (
  id         TEXT PRIMARY KEY,                                   -- uuid
  app_id     TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  comp_id    TEXT NOT NULL,                                      -- iTunes trackId (the lookup key)
  name       TEXT NOT NULL DEFAULT '',                           -- display name at add time
  source     TEXT NOT NULL DEFAULT 'user'                        -- 'user' | 'discovered'
               CHECK (source IN ('user', 'discovered')),
  status     TEXT NOT NULL DEFAULT 'confirmed'                   -- 'suggested' | 'confirmed'
               CHECK (status IN ('suggested', 'confirmed')),
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (app_id, comp_id)
);
CREATE INDEX IF NOT EXISTS idx_tracked_comp_app ON tracked_competitors(app_id, status);
```

`status` is the honesty seam: `suggested` rows are auto-discovered candidates that have **not** been confirmed and are **not** watched; `confirmed` rows are watched. Provenance (`source`) lets the UI label "suggested by ShipASO."

### 3.2 Discovery engine (pure, injectable — matches existing engine style)
New `cloud/src/engine/competitorDiscovery.ts`. Reuses the existing iTunes layer (`itunes.ts`'s `FetchFn`, `fetchJson`, `buildUrl`, `ITUNES_SEARCH_URL`, `asResponse`) so it stays Worker-portable and unit-testable exactly like `competitorWatch.ts`.

Algorithm (no fabricated signals — all inputs are observable):
- For each of the app's tracked keywords (and the app's genre name), call iTunes Search (`entity=software`, modest `limit`), collect `{ trackId, trackName, genres }`.
- Exclude the app itself (by `bundleId`/`trackId`).
- Score candidates by **observable overlap only**: how many of the app's keywords they surfaced on + shared genre. This is a transparent frequency count, not a modeled "relevance %."
- Return a capped, de-duped, score-sorted `CompetitorCandidate[]` (`{ compId, name, genres, matchedKeywords: string[], score }`). `matchedKeywords` is the *evidence* the UI shows ("appears for: budget, expense") so the suggestion is auditable, never a black-box guess.

Signature mirrors `competitorWatch.resolveNameToId`: takes `FetchFn`, never throws (returns `[]` on failure), pure aside from the injected fetch.

### 3.3 Run-path wiring — the closed loop
A new `cloud/src/d1.ts` helper `getConfirmedCompetitors(db, appId): Promise<string[]>` returns confirmed `comp_id`s. Thread it into the three run paths so the watched set is storage-backed, with the request body as an explicit override only:

- `runApp` (`cloud/src/api/index.ts:869-877`): after `getLatestCompetitorMap`, also `const tracked = await getConfirmedCompetitors(env.DB, appId);` and set `overrides.competitors = body.competitors ?? tracked;`
- `runAppWithAsc` (`:964-967`): same.
- `connectApp` (`:796-799`): leave audit-only connect as-is (no competitors yet — nothing to confirm on a brand-new app), but kick off **discovery candidate generation** here so the app page has suggestions on first view.
- cron (`cloud/src/cron/scheduled.ts:129`): pass `{ competitors: await getConfirmedCompetitors(env.DB, app.id), ... }` into `buildAppInput`.

The engine already handles ids correctly: `classify` (`agent.ts:137`) routes numeric trackIds straight to `lookupAll(..., {by:"id"})` (`agent.ts:244`) — so storing trackIds means zero per-run name-resolution round-trips and a stable diff key (`comp_id` == `competitor_snapshots.comp_id`).

### 3.4 New API routes (slot into the `/apps/:id/...` router at `cloud/src/api/index.ts:1894-1911`)
- `GET  /apps/:id/competitors` — `{ confirmed: [...], suggested: [...] }` (suggested = discovery candidates not yet confirmed/dismissed). Owner-scoped via `requireOwnedApp`.
- `POST /apps/:id/competitors` — body `{ add?: [{compId,name}], confirm?: [compId], remove?: [compId] }`. Validates/caps, writes `tracked_competitors`. Manual add resolves a typed **name** via the existing `resolveNameToId` (`competitorWatch.ts:105`) so the user adds by name but we store a trackId.
- `POST /apps/:id/competitors/discover` — runs discovery now, upserts results as `status='suggested'`, returns them. (Idempotent on `(app_id, comp_id)`.)

All read-only on the store; **no outward push**; competitor **names + listing fields only** ever reach the client (same boundary as the war room, `index.ts:1198`).

### 3.5 Frontend (`cloud/public/app.js`)
- App page: a **Competitors** card — confirmed chips (removable) + a "Suggested by ShipASO" section (each candidate shows its `matchedKeywords` evidence + Confirm/Dismiss). A "Find competitors" button calls `/discover`. A small "Add by name" input posts to `/competitors`.
- Suggested candidates are visually distinct and labeled unconfirmed — they are **not** presented as "watched." Only confirmed feed the run.
- War-room selector (`app.js:1811-1891`) keeps reading `comp.listings`, which now populates because confirmed competitors get looked up — no change needed beyond it finally having data. (Optionally also seed available names from the confirmed set so the war room works before the first full run.)

---

## 4. Exact files to change + new files

**New files**
- `cloud/src/engine/competitorDiscovery.ts` — pure discovery (iTunes Search overlap scoring).
- `cloud/src/engine/competitorDiscovery.spec.ts` — unit tests (injected `FetchFn`).
- `cloud/src/d1.tracked-competitors.spec.ts` (or extend an existing d1 spec) — storage CRUD + cascade tests.

**Changed files**
- `cloud/schema.sql` — add `tracked_competitors` table + index + the inline `ALTER`/migration comment block (follow the existing migration-note convention at `schema.sql:37-46`).
- `cloud/src/d1.ts` — add `TrackedCompetitorRow` type, `getConfirmedCompetitors`, `getTrackedCompetitors`, `upsertTrackedCompetitors`, `removeTrackedCompetitor`; ensure `deleteApp` (`d1.ts:373-381` batch) cascades (FK `ON DELETE CASCADE` covers it, but add an explicit delete for parity/clarity).
- `cloud/src/api/index.ts` — 3 handlers (`listCompetitors`, `updateCompetitors`, `discoverCompetitors`) + 3 router lines at `:1894`; wire `getConfirmedCompetitors` into `runApp` (`:870`) and `runAppWithAsc` (`:965`); trigger discovery in `connectApp` (`:802` area).
- `cloud/src/engine/index.ts` — re-export the discovery fn (next to `competitorWatch` exports at `:23-30`).
- `cloud/src/cron/scheduled.ts` — pass confirmed competitors into `buildAppInput` (`:129`).
- `cloud/public/app.js` — Competitors card + handlers; (optional) war-room available-name seeding.
- `cloud/public/mock.js` — add competitor fixtures so the mock dashboard exercises the new card.

**Changed tests**
- `cloud/src/api/*.spec.ts` (route-level) and `cloud/src/cron/scheduled.spec.ts` — assert confirmed competitors reach the engine input.

---

## 5. Test plan (TDD, `*.spec.ts`, colocated — repo convention)

Write failing tests first, then implement.

**Unit — `competitorDiscovery.spec.ts`** (inject a mock `FetchFn`, no network — mirrors `competitorWatch.spec.ts` / `rankWarRoom.spec.ts`):
- given keywords → returns candidates ranked by observed keyword-overlap count.
- **excludes the app itself** (own bundleId/trackId never appears).
- de-dupes a competitor that surfaces on multiple keywords; `matchedKeywords` aggregates all evidence.
- caps result count; deterministic ordering on equal scores.
- fetch failure / empty results → returns `[]` (never throws — parity with `resolveNameToId`).
- **honesty:** every candidate carries non-empty `matchedKeywords` evidence (no candidate without an observable reason).

**Unit — D1 storage spec:**
- upsert is idempotent on `(app_id, comp_id)`; `confirm` flips `suggested`→`confirmed`.
- `getConfirmedCompetitors` returns only `confirmed` trackIds (suggested excluded).
- app delete cascades tracked rows (no orphans) — extend the `deleteApp` test.

**Integration / route specs:**
- `POST /apps/:id/competitors {add:[name]}` resolves name→trackId and persists; another user's app 404s before any write (ownership, `requireOwnedApp`).
- `GET /apps/:id/competitors` returns `{confirmed, suggested}` partition.
- `POST .../discover` populates `suggested` and is idempotent.
- caps enforced (reject/clip oversized add lists — same defensive posture as `MAX_WAR_ROOM_COMPETITORS`, `index.ts:1187`, and keyword sanitization, `runConfig.ts:114`).

**Run-path / cron specs:**
- `runApp` with confirmed competitors in D1 (and no `body.competitors`) → engine input `competitors` equals the confirmed trackIds → run produces non-empty `competitors.listings` (using a mock fetch) → `competitor_snapshots` rows written (`d1.ts:508`).
- `body.competitors` still overrides storage when supplied.
- `runWeeklySweep` (`scheduled.spec.ts`) → confirmed set reaches `buildAppInput`; with movement, `evaluateThreshold` (`scheduled.ts:54`) crosses and opens a run.

**E2E / mock UI:** with `mock.js` fixtures, the Competitors card renders confirmed chips + suggested candidates with evidence; Confirm moves a candidate into the watched set; the war-room selector shows chips. Assert suggested candidates are never labeled "watched."

---

## 6. Honesty & security considerations

This product's core value is honesty — the design enforces it structurally:

- **Never present unseen data as measured.** Discovered candidates are persisted as `status='suggested'` and rendered as explicitly unconfirmed *suggestions* with their observable `matchedKeywords` evidence. They do **not** enter the watched set, do **not** appear in the "Watched competitors" step, and the run step's existing honest gate (`app.js:1470`) stays intact. Only user-`confirmed` competitors are watched.
- **No guessed numbers.** Discovery scores by transparent keyword-overlap counts (an observed fact), not a modeled relevance %. Competitor ranks in the war room remain `null`/"—" when unchecked (`index.ts:1196`, `rankWarRoom.ts:18-24`) — unchanged.
- **No private data.** We only ever read/track the visible `WATCH_FIELDS` (`competitorWatch.ts:22`). Only competitor **name + visible listing fields** cross the client boundary; raw extra data stays server-side (same boundary the war room and findings already hold).
- **`.p8` is never persisted.** This feature touches **only** the free iTunes APIs — it adds no ASC calls and never reads/stores credentials. The ephemeral-`.p8` posture of `/run-asc` / `/asc/push` is untouched.
- **The agent never auto-pushes.** All new routes are read-only against the stores and write only to our own D1. Confirmation of a competitor is a tracking-list edit, not a store action. The approval gate and "prepare, don't push" model (`scheduled.ts:19`, schema status enum at `schema.sql:8-13`) are unchanged.
- **Untrusted input hardening.** `add`/name inputs are sanitized + capped at the single API chokepoint (mirroring `sanitizeKeywords`, `runConfig.ts:114`, and the war-room cap, `index.ts:1187`): cap the tracked set size per app, strip control chars, length-limit names, dedupe. Ownership enforced via `requireOwnedApp` before any read/write.
- **Bounded fan-out.** Discovery and per-run lookups are capped so a malicious or large keyword set can't fan out unboundedly against iTunes.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| iTunes Search returns noisy/irrelevant candidates | Hybrid (Option C): user confirms before anything is watched; evidence shown per candidate; conservative caps. |
| Discovery latency on connect adds round-trips to a UX-sensitive path | Run discovery **after** the audit-only connect returns (or lazily on the `/discover` route / first app-page view), not inline-blocking the connect response. |
| Per-run lookup fan-out grows with the confirmed set | Cap confirmed set per app; lookups are sequential + retry-bounded already (`competitorWatch.lookupAll`, `itunes.fetchJson`). |
| Migration on an existing remote D1 | `CREATE TABLE IF NOT EXISTS` + documented `wrangler d1 execute` ALTER note, matching the established `schema.sql` convention. Additive only — no backfill required; existing apps simply start with an empty confirmed set. |
| Stale suggestions | `/discover` is idempotent and re-runnable; suggestions can be re-fetched. |

**Rollout:** additive and backward-compatible. Older runs/traces with empty competitors keep rendering the honest "No competitors added yet" state. Ship behind no flag needed (no destructive change), but land **storage + run-path wiring first** (closes the loop for users who add by name), then **discovery + UI** second.

---

## 8. Effort estimate

**M.** Storage + d1 helpers + run-path wiring is small and mechanical (the engine already consumes trackIds via `classify`/`lookupAll`). Discovery engine + its tests is a self-contained pure module. The UI card is the largest single piece. No new external dependency, no credential surface, no migration backfill.

Rough split: storage/wiring (S), discovery engine + tests (S–M), API routes + tests (S), frontend card + mock (M).

---

## 9. Decision required before building

The issue lists A/B/C/D. **D (honesty copy) is already shipped** (`app.js:426`, `app.js:1470-1475`) — so the remaining choice is the *collection mechanism*:

- **A — auto-discover & auto-watch:** best "agent does the work" UX, but it would watch unconfirmed guesses — weakest on honesty.
- **B — user enters competitors only:** lowest effort, fully honest, but no agent help; user must know their competitors.
- **C — hybrid (auto-discover candidates → user confirms):** strongest — accurate *and* honest *and* user-controlled. **Recommended (this PRD specs C).**

**Owner decision needed:** confirm **Option C** (and the honesty stance that discovered candidates are never watched until confirmed). If the owner prefers A (auto-watch discovered competitors) the `status='suggested'` gate and the confirm UI are dropped — a materially different honesty posture, so this needs an explicit call before implementation.

