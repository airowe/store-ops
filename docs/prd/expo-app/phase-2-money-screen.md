# Phase 2 — Read money screen PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phase 1.

## Objective
The highest-value read-only loop on the phone: app detail (rank movement, trend,
runs) → run detail (findings, coverage, screenshot gallery + levers, keyword
gaps/opportunities) → approval gate that reveals the **handoff commands** + the
fastlane zip. No credentials needed; everything renders server data faithfully.

## Scope
- **In:** app detail screen; run detail screen; approval gate (approve/reject);
  push-commands handoff; fastlane.zip download/share; all read cards.
- **Out:** ASC/Play credential runs (Phase 3); war room/share/portfolio (Phase 4).

## Files
- `mobile/app/(app)/apps/[id].tsx`, `mobile/app/(app)/runs/[id].tsx`
- `mobile/src/components/{RankMovementRow,Sparkline,FindingCard,CoverageGauge,
  ScreenshotGallery,LeverList,SurfaceLock,ApprovalGate,KeywordGapList,OpportunityList}.tsx`
- `mobile/src/lib/motion.ts` (Reanimated count-up + flash, Reduce-Motion aware)
- `mobile/src/api/endpoints.ts` (+ `getApp`, `getRanks`, `getDeltas`, `getRun`,
  `decideRun`, `pushCommands`, `fastlaneZip`)
- tests: `RankMovementRow.test.tsx`, `runDetail.test.tsx`, `approvalGate.test.tsx`,
  `coverageGauge.test.tsx`, `screenshotGallery.test.tsx`

## Contracts / reuse
- `GET /apps/:id` (row + latest run + proposals), `GET /apps/:id/ranks` (trend),
  `GET /apps/:id/deltas` (movement), `GET /runs/:id` (findings/coverage/gallery/
  gaps/opportunities/proposed copy), `POST /runs/:id/approve {decision}`,
  `GET /runs/:id/push-commands`, `GET /runs/:id/fastlane.zip`.

## Acceptance criteria
- Rank movement: prev→cur count-up + direction chip; single-snapshot = `new`/cur
  with **no fabricated count-up**; unchecked = "—". Reduce-Motion → jump to final.
- Screenshot gallery renders real URLs; the `?`/unreadable case renders **no
  gallery** (honest empty state), and levers panel is absent for `?`/A-grade.
- Coverage gauge shows score + itemized waste; unseen fields read UNKNOWN, not 0.
- Findings sorted by severity×impact (as returned); `SurfaceLock`s render as
  capability gaps ("connect to unlock"), never deficiencies.
- Approval gate: push commands **hidden until approved**, then revealed as a
  copyable handoff; reject path works. Fastlane zip downloads + shares.

## Tests
- Honesty invariants: `?`-grade → no gallery/levers; locks ≠ deficiency;
  unmeasured ≠ 0; push commands hidden pre-approval and never executed client-side.
- Motion: Reduce-Motion path renders final values with no animation.
- Fixtures = the `mock.js` run/app payloads (no network).

## Dependencies / external gates
- None beyond Phase 1. Pure consumption of existing routes.

## Definition of done
A user can open a connected app, read its movement/trend, open a run, read the
full audit, approve, and get the handoff + zip — all on device, all honest.
