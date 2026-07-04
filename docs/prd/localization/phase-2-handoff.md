# Phase 2 — persistence + multi-locale handoff

Depends on: Phase 1. Completes the credential-free path: approved locales ride
the fastlane bundle.

## Persistence — approved drafts on the run trace

- New trace field: `localizedCopy?: Record<string, CopyFields>` (locale →
  fitted copy). Written ONLY by the explicit per-market approve action:
  `POST /runs/:id/localize/approve { locale, copy }`.
- The server **re-validates** the submitted copy (`validateCopy` + brand-token
  check + limits) — the client's draft is a proposal, the server is
  authoritative (same posture as `finalizeEditedCopy`).
- The user may EDIT the draft before approving (the whole point of the review
  gate); edits ride the same body.
- `DELETE /runs/:id/localize/:locale` — un-approve (remove from the map).
- Storage piggybacks the existing `updateRunCopy` mechanism (reasoning_json
  update); no schema change, no migration.

## Fastlane bundle — multi-locale tree

- `buildFastlaneBundle` grows `locales?: Record<string, CopyFields>`:
  emits `fastlane/metadata/<locale>/{name,subtitle,keywords,promotional_text}.txt`
  per approved locale **in addition to** the primary locale's tree.
- The bundle README lists exactly which locales are included and repeats the
  machine-translated caveat per generated locale.
- Pin in a test: an unapproved/generated-but-not-approved locale NEVER appears
  in the bundle (the honesty success-criterion from the plan).

## Honesty

- The run page's handoff section lists included locales explicitly
  ("en-US + de-DE, ja — 2 machine-translated drafts you approved").
- `locale_single` / expansion-card copy unchanged — a bundled draft is not a
  live locale (G4 from the plan).

## Tests

- Approve round-trip (store → bundle contains the tree), re-validation rejects
  over-limit/brand-broken submissions loudly, un-approve removes the tree,
  unapproved-never-bundled pin, README locale list.
