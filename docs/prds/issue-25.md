# PRD — Competitor-selectable animated rank deltas (rank war room)

**Issue:** #25 "Growth: competitor-selectable animated rank deltas (rank war room)"
**Author:** airowe · **Status:** open
**Owner sign-off required before build:** YES — one product decision (see §6 and §9).

---

## 0. TL;DR for the reader

The issue body describes the war room as net-new ("Today the dashboard has two separate, static pieces… Neither lets you choose competitors or see movement"). **That description is stale.** Since the issue was filed, most of the war room has already shipped under "PRD 05":

- A pure, fully-tested builder `buildWarRoom` exists at `cloud/src/engine/rankWarRoom.ts:161` (10 passing specs in `rankWarRoom.spec.ts`).
- A live API endpoint `GET /apps/:id/war-room?competitors=…` exists at `cloud/src/api/index.ts:1201`, routed at `cloud/src/api/index.ts:1906`.
- A full UI card with a competitor chip-selector and head-to-head grid exists at `cloud/public/app.js:1811` (`warRoomCard`), mounted on the run view at `cloud/public/app.js:1004`.

So this issue is **~70% done already**. What is genuinely missing, and what this PRD scopes, is the headline feature in the title: **animated rank *deltas*** — the count-up + green/red pulse on prev→cur, reusing the shipped `rank-pop`/`rank-arrow` motion — for **both your app and each selected competitor**, with the honesty guardrails intact.

The work splits into two tracks with a load-bearing decision between them:
- **Track A (UI-only, low risk):** animate **your** column and the **gap/trend** chips in the existing grid using data the API already returns. Ships value immediately.
- **Track B (data, needs a DECISION):** to animate a *competitor's* prev→cur delta we need a **historical competitor rank** to count up from. Today none exists — competitors are live-checked once at `checked_at = today` (`index.ts:1235`) and `competitor_snapshots` (schema.sql:95) stores **listing fields, not per-keyword rank**. Animating a competitor delta therefore requires either persisting competitor ranks over time or knowingly degrading to a single-snapshot reveal.

---

## 1. Problem & context

### What the dashboard does today

- **`rankCard`** (`app.js:1598`) — your organic ranks per keyword. The on-render `rank-pop` + top-10 up-arrow (`app.js` ~1602–1605) are *decorative* ("you're in the top 10 here"), **not** a measured week-over-week delta.
- **`competitorCard`** (`app.js:1577`) — a read-only list of tracked competitor listings (new/changed/same). No rank numbers, no selection, no animation.
- **`warRoomCard`** (`app.js:1811`) — already lets the user pick competitors (chip toggles, `app.js:1879`) and renders a head-to-head grid (You vs each competitor, gap-to-best, trend), sorted by closeable gap. **But every cell is static** (`pos` spans, `app.js:1847–1849`); there is no count-up, no pulse, no prev→cur movement shown.

By contrast, the **#24 rank-movement card** (`rankMovementCard`, `app.js:703`) already does exactly the animation we want: a `dprev → dcur` count-up via `countUpRank` (`app.js:393`), a direction-tinted `dchip`, an arrow glyph, and a staggered `--i` reveal — all honoring `prefers-reduced-motion` (`REDUCED_MOTION`, `app.js:392`). The war room does not reuse any of it.

### Why it matters

The war room's job is to make a competitive gap *feel* closeable. A static grid of numbers reads like a spreadsheet; an animated prev→cur ("you went **#18 → #15**, they slipped **#8 → #11**, gap **+10 → +4**") makes the race legible and motivating, and is the literal title of this issue. The motion vocabulary is already shipped and consistent across the product (#23 share card, #24 deltas) — the war room is the one rank surface that hasn't adopted it.

### The data gap (shared with #24)

The issue correctly identifies the shared dependency: **last-two-distinct rank snapshots surfaced through the API**. For **your** app this is **already solved** — `getRankHistory` (`d1.ts:607`) returns the full `RankSnapshotRow[]` time-series, `lastTwoDistinct` (`rankWarRoom.ts:114`, mirrored from `digest.ts`) extracts current/previous, and `GET /apps/:id/deltas` (`index.ts:1119`) already serves `{current, previous, delta, direction}` to the #24 card. The war room builder already computes your `trend` from current/previous (`rankWarRoom.ts:176`).

The gap that remains is **competitor-side**: there is no historical competitor rank to derive a competitor delta from (see §6). That, plus the missing UI animation wiring, is the whole of this issue.

---

## 2. Goal & non-goals

### Goals

1. **Animate the war-room grid.** In `warRoomCard`, reuse the `countUpRank` + `rank-pop` motion so:
   - **Your** cell counts up prev→cur and pulses green (gaining) / red (losing), driven by the same trend the builder already computes.
   - The **gap** chip animates/tints by direction and the **trend** chip uses the shipped pulse classes.
   - Animation is staggered (`--i`) and **respects `prefers-reduced-motion`** (jumps to final value), matching `app.js:392–395`.
2. **Surface your prev rank in the war-room API** so the UI doesn't have to recompute it client-side. Extend `HeadToHead` with `youPrevious: number | null` (pure builder change, TDD red→green).
3. **Default the picker to top movers.** Seed the selected-competitor set to the competitors with the largest current gap (most movement to chase), not "all available," per the issue ("defaulting to the top movers").
4. **Graceful fallback (honesty).** Any app/competitor with only one snapshot keeps a clean single-snapshot reveal (no fabricated count-up). This is the existing `from == null → no tween` path in `countUpRank` (`app.js:395`).
5. **Make a clear DECISION on competitor deltas** (§6) and implement whichever branch the owner picks.

### Non-goals

- **Not** re-architecting the live competitor check into a background cron (out of scope unless the owner picks Track B-persist; even then, minimal).
- **Not** adding new competitor listing fields to the client (privacy boundary: only NAME + rank crosses — `index.ts:1198`, `rankWarRoom.ts:26`).
- **Not** auto-pushing or writing anything to App Store Connect. The war room is read-only and stays read-only.
- **Not** charting/sparklines for competitors (a separate ask).
- **Not** touching #23/#24 surfaces beyond reusing their CSS/helpers.

---

## 3. Proposed approach (grounded in real files)

### 3A. Builder: add your previous rank to the head-to-head row (pure, TDD)

`buildWarRoom` already computes `previous` internally via `lastTwoDistinct` (`rankWarRoom.ts:176`) but **discards it** — only `trend` survives onto the row. Surface it.

- `cloud/src/engine/rankWarRoom.ts:46` — extend the `HeadToHead` type:
  ```ts
  export type HeadToHead = {
    keyword: string;
    you: number | null;
    youPrevious: number | null;   // NEW — your prior-distinct-snapshot rank, null if single snapshot
    competitors: Array<{ name: string; rank: number | null; previous?: number | null }>; // previous only if Track B
    gapToBest: number | null;
    gapPrevious?: number | null;  // NEW (Track B only) — best-competitor gap last snapshot
    trend: WarTrend;
    winning: boolean;
  };
  ```
- `cloud/src/engine/rankWarRoom.ts:176` — in the loop, capture `previous` and set `youPrevious: previous` on the pushed row (`rankWarRoom.ts:207`).
- **Honesty:** `youPrevious` is `null` for single-snapshot keywords — the UI must treat `null` as "no measured prior" and skip the count-up (no invented start value). This is already how `countUpRank` behaves with `from == null`.

This is a **pure builder change** → write the failing spec first (§5), then implement. No new I/O.

### 3B. API: pass through (no shape surprises)

`warRoom` (`index.ts:1201`) already maps `getRankHistory` → `yourRanks` (`index.ts:1213`) and calls `buildWarRoom` (`index.ts:1241`). Once the builder emits `youPrevious`, it flows out through `warRoom`'s return (`index.ts:1242`) for free. No new endpoint, no new DB read for the "your delta" path.

The endpoint already returns `checkedAt` and `window: 7` (`index.ts:1246–1247`) — the UI should surface `checkedAt` as the honest "as of" timestamp on the card (we currently don't show it).

### 3C. UI: animate the existing grid

`warRoomCard` (`app.js:1811`) → `renderGrid` (`app.js:1830`). Today each cell is a static `pos` span (`app.js:1847`). Rework `renderGrid` to mirror `rankMovementCard` (`app.js:703`):

- **Your cell:** render a `dprev → dcur` pair; call `countUpRank(curEl, r.youPrevious, r.you, 120 + i*60)` (reuse `app.js:714`). Apply `rank-pop good`/`rank-pop bad` based on `r.trend` (gaining → good/green, losing/lost → bad/red), reusing the shipped pulse. Stagger via `style: "--i:" + i`.
- **Gap chip:** keep the existing `+N` / "winning" / "—" logic (`app.js:1852–1857`) but add a directional tint using the trend so a closing gap pulses green. (If Track B ships, animate gap count-up too via `gapPrevious`.)
- **Trend chip:** the `WAR_TREND` map (`app.js:1803`) already maps to `good`/`bad`/`neutral` classes — wrap it in a `rank-pop`/`flip-in` so it pulses in on render, matching `dchip` (`app.js:720`).
- **`prefers-reduced-motion`:** no new work — `countUpRank` already short-circuits on `REDUCED_MOTION` (`app.js:395`), and the `rank-pop`/`flip-in` CSS already gates animation behind the media query in `styles.css` (verify in §4). Confirm the war-room classes inherit that gate; if not, add the war-room selectors to the existing `@media (prefers-reduced-motion: reduce)` block.

### 3D. UI: default selection to top movers

Today `warRoomCard` seeds `selected` from the payload's competitors **or all available** (`app.js:1825`). Change the default-when-no-seed to the competitors with the **largest current `gapToBest` contribution** (i.e., the competitors that are actually ahead of you on the most/widest keywords), capped at `MAX_WAR_ROOM_COMPETITORS` (4, `index.ts:1187`). Compute from `initial.warRoom` if present; otherwise do an initial `refresh()` with all available and re-seed from the response. Keep it deterministic (stable name tie-break) to match the builder's determinism contract.

### 3E. Competitor deltas — see §6 (the DECISION). The builder/UI hooks above (`competitors[].previous`, `gapPrevious`) are left optional so Track A ships without them and Track B fills them in.

---

## 4. Exact files to change + new files

### Changed files

| File | Change |
|---|---|
| `cloud/src/engine/rankWarRoom.ts` | Add `youPrevious` to `HeadToHead` (`:46`); capture & emit `previous` in the build loop (`:176`, `:207`). (Track B: add optional `competitors[].previous` + `gapPrevious`.) |
| `cloud/src/engine/rankWarRoom.spec.ts` | New failing specs for `youPrevious` + single-snapshot `null` fallback + (Track B) competitor previous. |
| `cloud/src/api/index.ts` | No new endpoint. (Track B-persist only: in `warRoom` `:1201`, read persisted competitor history instead of/in addition to the live check; map to `competitorRanks` with two snapshots.) Surface `checkedAt` is already returned. |
| `cloud/public/app.js` | Rework `renderGrid` inside `warRoomCard` (`:1830`) to animate your cell via `countUpRank`, pulse trend/gap, stagger `--i`; change default selection to top movers (`:1825`); show `checkedAt` "as of" line. |
| `cloud/public/styles.css` | Add war-room cell/chip animation selectors to the existing `rank-pop`/`flip-in` rules **and** the `@media (prefers-reduced-motion: reduce)` block. Reuse existing keyframes — do not invent new ones. |
| `cloud/public/mock.js` | Add `youPrevious` (and Track B previous) to the mocked war-room fixture so demo/mock mode animates and E2E can assert without a live network call. |

### New files

| File | Purpose |
|---|---|
| `cloud/tests/e2e/war-room.e2e.ts` | New Playwright E2E: selector toggles re-fetch; your cell animates/pulses; reduced-motion path jumps to final; single-snapshot fallback shows no fake count-up. Mirrors `tests/e2e/attribution.e2e.ts` conventions and uses `tests/e2e/helpers.ts`. |
| *(Track B-persist only)* migration in `cloud/schema.sql` + a `saveCompetitorRanks`/`getCompetitorRankHistory` pair in `cloud/src/d1.ts` | Persist per-keyword competitor rank time-series (see §6). |

No new API route. No new engine module (the builder already exists).

---

## 5. Test plan (TDD, `*.spec.ts` + Playwright)

Follow the repo's **red → green**: write the failing spec, watch it fail, implement.

### Unit (`rankWarRoom.spec.ts`, Vitest — colocated)

1. **`youPrevious` from two distinct snapshots** — given your `[#18@06-03, #15@06-10]`, the `budget app` row has `youPrevious === 18`, `you === 15`, `trend === "gaining"`. (Extends the existing first spec, `rankWarRoom.spec.ts:22`.)
2. **single-snapshot → `youPrevious: null`** — given one snapshot for a keyword, `youPrevious` is `null` (UI fallback path). Strong assertion: `toBeNull()`, never `0`.
3. **`youPrevious` uses two-distinct rule** — same-day duplicate snapshots collapse; previous is the next *distinct* `checked_at` (mirror `rankWarRoom.spec.ts:137`).
4. **determinism unchanged** — re-run the existing sort/tie-break specs (`:116`, `:191`) to prove the new field doesn't perturb ordering.
5. **(Track B)** competitor `previous` is `null` when we have only one competitor snapshot, and the real prior when two exist; `gapPrevious` computed from prior best-known competitor rank; unknown competitor previous never coerced to `0` (honesty).

### API (within existing patterns)

There is no `index.spec.ts` for `warRoom` today; the endpoint is exercised via E2E. If we add a focused unit, assert that `warRoom`'s return includes `youPrevious` and a single live competitor snapshot yields competitor `trend`-equivalent of "new" (no fabricated prior) — keeping the live-check honesty explicit.

### E2E (`cloud/tests/e2e/war-room.e2e.ts`, Playwright)

- Load a run view with a seeded war room (mock mode via `mock.js`).
- **Selector:** toggling a `.war-chip` re-fetches and re-renders the grid (assert column appears/disappears).
- **Animation present:** your cell ends on the correct `#N`; the cell carries `rank-pop` and the correct `good`/`bad` class for the trend.
- **Reduced-motion:** with `page.emulateMedia({ reducedMotion: 'reduce' })`, the cell shows the **final** value immediately (no intermediate count-up frames) — asserts the `REDUCED_MOTION` branch.
- **Fallback honesty:** a single-snapshot keyword renders the current value with **no** "previous →" pair and **no** fabricated delta.
- **Unknown competitor:** a `—` cell stays `—` (never a number) — re-assert the privacy/honesty contract end-to-end.

### Quality gates (per user standards)

Run `lint + typecheck + vitest + playwright` green before any commit. No commit without explicit owner approval; agent never auto-pushes.

---

## 6. The DECISION the owner must make (competitor deltas) — honesty-critical

**The animation in the title implies a competitor delta (prev → cur). Today that is impossible to show honestly, and the cheap way to fake it would violate this product's core value.**

Why: the war-room endpoint **live-checks** each selected competitor exactly once and stamps `checked_at = today` (`index.ts:1232–1235`). `buildWarRoom` then sees a single competitor snapshot, so a competitor's `trend` is always `"new"` and there is no prior number to count up *from*. `competitor_snapshots` (schema.sql:95) stores **version/rating listing fields, not per-keyword rank**, so there's no history to backfill from either.

Three options:

- **Option 1 — Ship Track A only (RECOMMENDED for v1).** Animate **your** column + the gap/trend chips (all derivable from data we already have, honestly). Competitor cells stay as honest current ranks with `—` for unchecked. No schema change, no new persistence. Smallest, safest, ships the headline motion. The competitor *delta* arrives later once we have history.
  - **Effort: S.**

- **Option 2 — Track B-persist: store competitor ranks over time.** Persist the live-checked competitor ranks (extend `rank_snapshots` with a nullable `comp_id`, or add a `competitor_rank_snapshots` table) so that on the *second* war-room view we have a real prior to animate. Honest, but: (a) competitor deltas only appear after ≥2 checks of the *same* keyword set, (b) we'd ideally move competitor checks into the existing cron (`cron/scheduled.ts:221` already iterates apps + rank history) so history accrues without the user re-opening the page, (c) adds a schema migration + D1 read/write pair + cron wiring.
  - **Effort: M–L.** Needs a migration and a privacy review (still only NAME+rank persisted; never listing fields beyond what `competitor_snapshots` already holds).

- **Option 3 — Fake it (REJECTED).** Animate competitors from `null`/today only, or interpolate a prior. **Do not do this.** It would present unseen movement as measured — a direct violation of the honesty mandate codified in `rankWarRoom.ts:17–27` ("Unknown ≠ zero ≠ 'they don't rank'… we NEVER guess or interpolate a rank").

**Recommendation:** ship **Option 1 now** (delivers the animated war room the title promises for *your* deltas + gap/trend), and file/keep a follow-up for **Option 2** once the owner confirms they want to pay the persistence cost for competitor-side deltas. The builder/UI hooks in §3 are designed so Option 2 slots in without rework.

---

## 7. Honesty & security considerations

- **Never present unseen data as measured.** `youPrevious: null` (single snapshot) → no count-up, no invented start. Unknown competitor rank → `—`, never `0` or a guess (`rankWarRoom.ts:20–24`, `app.js:1819`). Option 3 is explicitly rejected.
- **Show provenance.** Surface the endpoint's `checkedAt` (`index.ts:1247`) as an "as of" line so the live-checked competitor numbers are clearly time-stamped, not implied to be continuously tracked.
- **Privacy boundary holds.** Only competitor NAME + rank crosses to the client (`index.ts:1198`, `rankWarRoom.ts:26`). The new `youPrevious`/optional competitor `previous` are still just rank integers — no listing fields. Re-assert in E2E.
- **No `.p8` persisted.** This feature touches iTunes Search (public, key-free) and D1 only. It reads/writes **no** App Store Connect credentials and must never cause the `.p8` to be stored. (No ASC code path is in scope.)
- **The agent never auto-pushes.** The war room is strictly read-only: no DB writes on the "your delta" path, no outward pushes (`index.ts:1199`). Track B's only write is appending rank snapshots — never a store mutation. The approval gate and command handoff (`index.ts:1301`, `:1354`) are untouched.
- **Fan-out cap preserved.** `MAX_WAR_ROOM_COMPETITORS = 4` (`index.ts:1187`) stays — the "top movers" default and any re-fetch must respect it so the live competitor check can't fan out unboundedly.

---

## 8. Risks & rollout

| Risk | Mitigation |
|---|---|
| Issue body is stale vs. shipped code; reviewer expects net-new build. | This PRD re-baselines: ~70% exists; scope is animation + your-prev + (decision) competitor history. |
| Animating a 2-D grid (rows × competitor columns) is heavier than the 1-D `#24` list; many `requestAnimationFrame` tweens. | Stagger via `--i`; reuse `countUpRank`'s background-tab safety net (`app.js:408`); cap competitors at 4; only your column + chips animate in v1 (Option 1), bounding the tween count. |
| `prefers-reduced-motion` regression. | Reuse the existing gate; add war-room selectors to the `@media (prefers-reduced-motion: reduce)` block; assert in E2E with `emulateMedia`. |
| Mock/demo mode diverges from live shape, breaking E2E. | Update `mock.js` war-room fixture with `youPrevious` (and Track B fields) in the same PR. |
| (Track B) schema migration on D1. | Additive, nullable column / new table; gated behind owner go-ahead; ships separately from Track A. |

**Rollout:** Track A is a pure UI + pure-builder change behind no flag — it degrades gracefully (single-snapshot fallback) and is safe to ship to all users once tests are green. Track B ships only after the owner's Option-2 decision and gets its own migration + cron PR. Manual verification on the run view (real app with ≥2 weeks of your rank history) before merge, per repo TDD + quality-gate discipline.

---

## 9. Effort estimate & decision gate

- **Track A (your deltas + gap/trend animation + top-mover default + E2E): S** (~1 focused day). Pure builder field + UI rewire + specs; no schema, no new endpoint, no credentials.
- **Track B (competitor delta persistence + cron + migration): M–L** depending on whether competitor checks move into the cron.

**Needs an owner DECISION before building: YES — exactly one.** Pick the competitor-delta path (§6): **Option 1 (ship A now, recommended)**, **Option 2 (also persist competitor history, M–L)**, or explicitly defer competitor deltas. Track A can start immediately regardless; Option 3 ("fake it") is off the table on honesty grounds.

