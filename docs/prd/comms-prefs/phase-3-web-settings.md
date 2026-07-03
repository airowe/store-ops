# Phase 3 — Web settings PRD (comms-prefs)

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (API). Independent of
Phase 4.

## Objective

A "Communications" block in the web dashboard's settings area: digest on/off,
rank-check cadence (surfacing the existing API-only `rank_cadence` — found
UI-less during the audit), and honest read-only push status. Mirrors the
existing pause/RLHF toggle patterns in `app.js`.

## Scope

- **In:** settings UI for `email_digest` + `rank_cadence`; a read-only push line
  ("Run-ready push is managed on your phone" — the web has no device token);
  state from `/auth/me`, writes via `POST /account/notifications` and the
  existing `/account/rank-cadence`.
- **Out:** web push (no web push exists — do not fake a toggle); unsubscribe
  pages (Phase 2, served by the API); mobile (Phase 4).

## Files

- `cloud/public/app.js` — a `commsSettings(session)` block next to the existing
  `rlhfToggle` (same `el()` helper, same optimistic-flip-then-reconcile pattern
  as `toggleAgentPause`)
- `cloud/public/mock.js` — demo-backend handlers for `/account/notifications`
  (+ `rank-cadence` if absent) so the Pages-only preview stays fully clickable
- `cloud/public/styles.css` — reuse existing toggle styles; additions minimal
- e2e: `cloud/tests/e2e/commsSettings.e2e.ts` (mock backend)

## Contracts / reuse

- Read initial state from the booted `/auth/me` session object (Phase 1 put the
  prefs there — no extra fetch).
- Digest toggle copy states the honesty rule verbatim: "Stops the email, not the
  agent — runs keep opening."
- Cadence control: the two-value enum as a segmented control (`weekly` default /
  `daily`), POSTing `/account/rank-cadence`; failure restores the prior visual
  state (same reconcile pattern as pause).

## Acceptance criteria

- Toggling digest off POSTs `{email_digest:'off'}` and reflects the response;
  a failed POST restores the toggle (no lying UI).
- Cadence flips weekly↔daily against the real route and reflects the response.
- Push line renders informationally only — no interactive control the web can't
  honor.
- Works on the mock backend (demo preview) and the real one identically.

## Tests

- e2e (mock backend): digest toggle round-trip, cadence round-trip, failure
  restore. Unit: mock.js handlers return the right shapes.
- NOTE: this environment's Chromium-version e2e limitation applies — e2e must
  pass in CI (which runs the pinned browser), locally verified best-effort.

## Definition of done

A user can manage digest + cadence from web settings with honest copy; CI e2e
green.
