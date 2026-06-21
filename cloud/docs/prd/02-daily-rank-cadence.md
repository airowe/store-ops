# PRD 02 — Configurable + daily rank cadence

**Status:** Proposed
**Priority:** P1 (small, removes a visible loss, *feeds* the proof loop)
**Closes gap:** Appeeky takes **daily** rank snapshots by country and device. Our
cron is hardcoded `0 9 * * 1` (Monday 09:00 UTC) — weekly.
**Related issues:** #52 (configurable cadence/schedule), #53 (configurable
thresholds), #62 (rank timelines).

---

## Problem

"Daily rank snapshots" vs "weekly" is a face-value comparison loss. It's also a
*real* product limitation: weekly sampling means our before/after rank
attribution (`rankAttribution.ts`) has a 7-day resolution, which weakens the very
proof that is our wedge. Tighter cadence → tighter "the rank moved after your
push" evidence.

## Goals

1. Decouple rank-snapshotting cadence from the hardcoded weekly cron.
2. Support **daily** rank snapshots (the parity bar) without re-running the full
   weekly autonomous sweep daily (that would over-trigger drafts).
3. Make cadence **configurable per user/app** (#52), respecting `agent_paused`.

## Non-goals

- Not making the *autonomous draft/PR* run daily — only the lightweight rank
  *snapshot*. Drafting cadence stays governed by thresholds (#53).
- No new rank algorithm — reuse `rankCheck.ts` / `rankOpportunity.ts`.
- Not per-device-per-country matrix at launch (see Open questions) — start with
  the country set we already check.

## Proposed design

Split the cron into two responsibilities:

1. **Daily snapshot job** (`0 8 * * *`): for each active app, call the existing
   rank check, append a dated snapshot row to the rank-timeline table (#62), and
   diff competitor listings (`competitorWatch.diff`). Cheap, read-only, no drafts.
2. **Weekly sweep** (unchanged `0 9 * * 1`, or per-user via #52): the existing
   prepare → threshold → open-for-approval autonomous run.

Cadence config:

- Add a `rank_cadence` (`daily` | `weekly`) and optional `sweep_schedule` to the
  per-user settings (extends the same settings surface as `agent_paused` /
  `rlhf_opt_out`).
- Daily snapshot honors `agent_paused` (paused = no snapshots, consistent with the
  pause semantics in `d1.ts`).

## Data

- Rank-timeline table (overlaps #62) — `(app_id, keyword, country, rank,
  captured_at)`. Daily rows are the input to both proof attribution and a future
  rank-history chart.
- Storage cost: bounded; one row per (app, tracked-keyword, country, day).
  Document a retention window.

## Success criteria

- A user can set an app to daily snapshots; the cron writes one dated rank row per
  tracked keyword per day.
- The autonomous draft cadence is unchanged (no extra PRs from daily snapshots).
- `rankAttribution` can consume daily rows → before/after windows shrink from 7d
  to 1d resolution.

## Open questions

- Per-device (iPhone/iPad) and per-country expansion — match Appeeky's "by country
  and device," or start narrower? (Lean: ship daily for the existing country set
  first; expand the matrix in a follow-up.)
- Cloudflare Cron triggers are UTC and limited in number — confirm the two-cron
  split fits the plan's trigger budget.

## Rough size

**S–M** — mostly a cron split + a settings field + the timeline table. The rank
logic already exists.
