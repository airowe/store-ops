# PRD 07 — `/runs/:id` (the money screen) — migrate LAST

> The highest-stakes route: the PR-style current→proposed diff, the editable
> proposal with char budgets, the **approval gate on the one irreversible step**,
> the fastlane handoff, raw commands, and (until PRD 06 fully lands) the embedded
> war room + competitors + Play audit. Migrated **last**, only after the playbook
> is proven on 03–06, with its full E2E ported first. This is where an honesty
> regression would do real damage.

## The move
Port `viewRun(id)` (`app.js`) to `/runs/:id`, faithful to Expo
`(app)/runs/[id].tsx`. Preserve the exact approval semantics: **approval reveals
push commands; nothing has reached App Store Connect yet.** "Approved · ready to
push" — never "Shipped" without a confirmed push.

## Deliverables
- `cloud/web/app/routes/runs.$id.tsx` + components:
  - **Diff** — per-field current→proposed, `modified`/`added`/`unchanged`/`same`
    tags, char-count + budget bars, the `was`/`now` treatments.
  - **Editable proposal** — the "proposed" side as validated inputs; invalid
    over-limit input flagged loudly (`.invalid`), reset control.
  - **Approval gate** — the single guarded action; disabled → confirm → reveal
    commands. Optimistic status update in place (parity with the current gate).
  - **Fastlane handoff** (primary path) + collapsed **raw commands** (secondary).
  - **In-flight interstitial** (progress steps, not a frozen button).
  - **Tier-limit paywall** modal on HTTP 402.
- Data/mutations via `@shipaso/api`: run fetch, approve, edit-proposal submit.

## UI
- Diff columns collapse to single-column with a rotated arrow on narrow widths
  (parity). Reduced-motion disables the text-reveal.

## Honesty (maximal — this is the point of the route)
- **"Approved ≠ shipped."** The badge/label after approval says
  "Approved · ready to push"; a truthful "Shipped" is reserved for a confirmed
  push. Legacy `shipped` rows read the same honest copy.
- Char budgets never let an over-limit proposal look valid.
- The irreversible step is explicit and single; nothing auto-pushes.

## TDD
- **Port the full run-page E2E first** (`flows.e2e.ts` run-page block: diff
  rendering, editable-proposal validation, approval reveal, "approved ≠ shipped"
  labeling, 402 paywall) and get it green on the new route **before** any flip.
- Component tests for budget validation + gate state machine.

## Acceptance
- `/runs/:id` served by the new app with **100% of the run-page E2E green**.
- Approval flow reveals commands without ever claiming a push occurred.
- 402 surfaces the paywall modal.

## Coexistence / rollback
- Flip `/runs/:id` **only after** 03–06 are stable in production. Keep the legacy
  route one edge-flip away for an extended bake. Rollback = revert the entry (the
  API is unchanged, so no data migration risk).

## Dependencies
- **PRD 01–06.** The last and most guarded cutover; do not start until the
  pattern is boring.
