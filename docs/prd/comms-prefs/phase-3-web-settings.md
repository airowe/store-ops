# Phase 3 — Web settings PRD (comms-prefs) — v2

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (API). Independent of
Phase 4.

## Objective

**Create the web dashboard's settings surface** — it does not exist today (B2:
the only "settings" are the privacy `<a>` injected into the header by
`applyAuthHeader()` and the pause button inside `agentBanner()`; there is no
`#/settings` route, no panel, nothing to put a third control "next to") — and
put the Communications block in it: digest on/off, rank-check cadence
(surfacing the API-only `rank_cadence`), and honest read-only push status.

## Scope

- **In:** a `#/settings` hash route + `viewSettings()` in the SPA; a "Settings"
  link in the header auth strip; the Communications card (digest toggle,
  cadence segmented control, push status line); mock.js parity so the demo
  backend stays fully clickable.
- **Out:** relocating the existing privacy link or pause button (they stay
  where they are this phase); web push (none exists — no fake toggle);
  unsubscribe pages (Phase 2, API-served).

## Files

- `cloud/public/app.js` —
  - `route()`: add the `#/settings` case → `viewSettings()`
  - `applyAuthHeader()`: add a "Settings" link to the `.who` row (next to
    sign-out)
  - `viewSettings(session)`: page shell + `commsSettingsCard(session)` — same
    `el()` builder + optimistic-flip-then-reconcile pattern as
    `toggleAgentPause` (revert visual state on a failed POST)
- `cloud/public/mock.js` — G7: extend the demo `/auth/me` (today it returns only
  `{authed, via, email, rlhf_opt_out}` — no `paused`, no `rank_cadence`, no
  prefs) AND add handlers for `/account/notifications` (GET/POST) and
  `/account/rank-cadence` (absent today) so the Pages-only preview works.
- `cloud/public/styles.css` — reuse existing card/button styles; minimal adds.
- e2e: `cloud/tests/e2e/commsSettings.e2e.ts` (mock backend).

## Contracts / reuse

- Initial state from the booted `/auth/me` session object (Phase 1 put the
  prefs in BOTH server branches; mock.js now mirrors them).
- Digest toggle copy, verbatim honesty rule: "Stops the weekly digest email for
  every app on this account — the agent keeps working and runs keep opening."
- Cadence control: `weekly`/`daily` segmented control → POST
  `/account/rank-cadence`; labeled as what it IS (how often ranks are checked),
  never as an email-frequency control.
- Push line: informational only — "Run-ready push is managed in the mobile
  app." No interactive control the web can't honor.

## Acceptance criteria

- `#/settings` renders from the header link; deep-linking the hash works
  (logged-out → login screen, same as other authed views).
- Digest toggle round-trips `{email_digest}` and reflects the server response;
  failed POST restores the prior visual state (no lying UI).
- Cadence flips weekly↔daily against the route and reflects the response.
- Everything works identically on the mock backend (demo preview).

## Tests

- e2e (mock backend): settings navigation, digest round-trip, cadence
  round-trip, failure-restore.
- CI runs the pinned browser; local e2e is best-effort (known env Chromium
  mismatch).

## Definition of done

The web has a real settings page; digest + cadence manageable with honest copy;
CI e2e green.
