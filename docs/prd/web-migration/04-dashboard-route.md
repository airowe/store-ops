# PRD 04 — `/` dashboard (app-card grid)

> Migrate the home route: the grid of connected apps with per-app latest-run
> badge, lead rank, finding-count badge, and the card-level "run now" control.
> Medium risk — it's the first route with honest-rendering rules (unmeasured
> rank = "—", finding badge only when the server returned a summary) and the
> primary navigation hub into every other route.

## The move
Port `viewDashboard()` (`app.js`) to `/`, faithful to Expo `(app)/index.tsx` +
`AppCard.tsx`. Empty state = the connect/add-app flow.

## Deliverables
- `cloud/web/app/routes/index.tsx` + an `AppCard` web component (ported from the
  mobile one over the shared spine).
- Data via `@shipaso/api` `getApps()` under TanStack Query.
- Card: name, bundle id, latest-run `StatusBadge`, lead-keyword rank,
  finding-count badge (`looking-good` / warn / `has-critical`), "Run now" +
  honest helper copy (parity with `.appcard-foot`).
- Empty/loading/error states (ported `.empty`, spinner).

## UI
- `.grid` responsive card layout; hover elevation preserved.
- Navigation: card → `/apps/:id`; "Run now" → run creation → `/runs/:id`.

## Honesty
- Unmeasured rank renders **"—"**, never `0` or a guess.
- Finding badge appears **only** when `findings_summary` is present; label copy
  verbatim.
- "Run now" copy must not imply anything shipped — it queues a run.

## TDD
- Port `AppCard.test.tsx` assertions (unmeasured rank, conditional badge).
- Query-layer test: list renders from a fixture; empty list → connect CTA.

## Acceptance
- `/` served by the new app; card grid matches legacy visually + behaviorally.
- Relevant `flows.e2e.ts` dashboard specs pass pre-flip.
- All deep links from cards resolve (to migrated or still-proxied routes).

## Coexistence / rollback
- Flip `/` in the edge map. Because `/` is the hub, verify every outbound link
  targets a route that is either migrated or cleanly proxied before flipping.
  Rollback = revert the entry.

## Dependencies
- **PRD 01, 02, 03** (playbook proven). Feeds every downstream route via nav.
