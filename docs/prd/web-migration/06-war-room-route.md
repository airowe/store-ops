# PRD 06 — `/apps/:id/war-room` (route reconciliation)

> Migrate the competitor rank war room AND reconcile a real cross-surface
> divergence: it's an embedded card inside the web **run** view (`warRoomCard()`
> in `viewRun`) but a standalone **route** on mobile (`(app)/war-room/[id]`).
> Standardize on the mobile convention — a dedicated `/apps/:id/war-room` route —
> so both surfaces navigate identically.

## The move
Extract `warRoomCard()` + `renderGrid()` (`app.js`) into a standalone route,
faithful to Expo `(app)/war-room/[id].tsx` + `WarRoomGrid.tsx`. Entry points:
a "War room" action on `/apps/:id` (matching mobile) — not buried in the run view.

## Deliverables
- `cloud/web/app/routes/apps.$id.war-room.tsx` + a `WarRoomGrid` web component.
- Competitor selector chips → refetch `/apps/:id/war-room?competitors=…` (cap at
  `MAX_WAR_ROOM_COMPETITORS`), head-to-head per-keyword grid, gap column, trend
  tinting, "as of" provenance line.
- Multi-series chart (optional, PRD 08): you-vs-competitors lines over time.

## UI
- Chip toggles re-fetch + re-render the grid (parity with current behavior).
- Winning-row accent (`inset` signal bar) preserved; tabular-nums ranks.

## Honesty
- An unchecked competitor cell stays **"—"**, never a guessed number.
- A single-snapshot keyword shows the current rank with **no fabricated
  count-up**; reduced-motion jumps straight to the final value.
- The "as of" line states when the ranks were actually checked.

## TDD
- Port `WarRoomGrid.test.tsx` + the `war-room.e2e.ts` scenarios (selector
  re-fetch, honest "—", no fabricated count-up, reduced-motion).

## Acceptance
- `/apps/:id/war-room` served by the new app; all `war-room.e2e.ts` specs pass
  pre-flip.
- The run view no longer needs the embedded card once PRD 07 lands; during the
  interim both entry points resolve.

## Coexistence / rollback
- Because the legacy war room is reached from the run view, migrate this in
  lockstep awareness of PRD 07: the new standalone route can go live first (linked
  from the migrated `/apps/:id`), with the legacy run view keeping its embedded
  card until 07 flips. Rollback = revert the route + restore the `/apps/:id`
  entry link.

## Dependencies
- **PRD 05** (entry point lives on app detail), **PRD 08** (optional multi-series
  chart). Coordinated with **PRD 07**.
