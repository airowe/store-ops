# Posting calendar — 2026-09-07 to 2026-10-06

One post a day for 30 days. The rule that makes this survivable: **a post is
a receipt with a sentence on it.** Every slot below names the receipt it
draws on. A slot with no receipt on the day is swapped for whatever actually
happened; a day with nothing measured gets a "what I'm building" post, never
a number. Voice: first person, plain, no setups, no em-dash rhythm.

Cadence: X thread or single, then the Bluesky short, then Discord
#post-engagement-boost. Record every post URL on the journey feed entry it
belongs to. Tag @RevenueCat while #Shipaton runs.

| Day | Date | Post | Receipt |
|---|---|---|---|
| 1 | 09-07 | The first real write to App Store Connect (thread drafted) | `2026-09-07-first-live-write.md` |
| 2 | 09-08 | Autopilot, off by default: what it does and what it never does | PR #564, PRD `autopilot-execute.md` |
| 3 | 09-09 | asc 5.0 dropped and broke nine of my documented commands; the linter said "0 missing" | PR #563, negative control: 18 unknown flags |
| 4 | 09-10 | 32 runs I'd approved were never pushed. Why turning autopilot on did not touch them | quarantine count from D1, PR #564 second commit |
| 5 | 09-11 | The ops heartbeat: a bot that measures and files, never acts | PR #558, sticky issue after first run |
| 6 | 09-12 | screenmap: 13 screens, 11 identical. The login wall as a finding | `docs/screenmap/2026-09-05/contact-sheet.png` |
| 7 | 09-13 | Where a paying customer's agent actually runs (Cloudflare, D1, per-user keys) | code map on #557 |
| 8 | 09-14 | The team-scoped key: paste it once, every app | PR #560 |
| 9 | 09-15 | goldie config: the diagnosis half as a file, capture on your own Mac | PR #552, skill `aso-goldie-config` |
| 10 | 09-16 | What App Review saw: the token field, and why a magic link can't be reviewed | `2026-09-04-rejected-again.md` receipts |
| 11 | 09-17 | 0.1.1 review outcome, whichever it is | `asc versions list` on the day; if still waiting, post the wait honestly |
| 12 | 09-18 | The audit card: measured, pending, unavailable, absent. Four states, no zeros | PR #545, `auditCard.ts` |
| 13 | 09-19 | One week of the heartbeat: what flipped, what didn't | sticky issue history |
| 14 | 09-20 | How the engineering loop verified three issues were already done before building | #460, #525, #78 close comments |
| 15 | 09-21 | The strip lane ledger: uploaded, skipped, failed, never started | PR #559, live JSON from #374 |
| 16 | 09-22 | The MCP front door, three weeks in: anonymous tool count, still 12 | `tools/list` measured on the day |
| 17 | 09-23 | Rank readback: a keyword that moved, or one that didn't | a `win`-kind feed entry, only if one exists |
| 18 | 09-24 | Pricing: apps, not seats or keywords | `pricing.md` |
| 19 | 09-25 | Why the experiment is created stopped, and who presses start | `ascExperimentCreate.ts` header |
| 20 | 09-26 | Localization: the approved-locale path autopilot walks | PR #564 executor spec |
| 21 | 09-27 | The distribution loop itself, if #567 is built by now | #567 |
| 22 | 09-28 | Google Play: what exists (audit, data safety) and what doesn't (writes) | code map on #557 |
| 23 | 09-29 | A rejection guideline decoded: 2.1(a) and what "unresponsive" meant | `aso-rejection-assistant` |
| 24 | 09-30 | Month recap: PRs merged, issues closed, writes verified, all counted | `gh` counts on the day |
| 25 | 10-01 | The screenshot planner: what it refuses to say (no "best", no unmeasured claims) | `screenshotPlanner.ts` lint |
| 26 | 10-02 | What the dashboard shows now that autopilot has switches | PR #566 screenshots |
| 27 | 10-03 | A customer question answered in public, if one arrived | inbox; else skip to a build note |
| 28 | 10-04 | Every number on the site is measured or a dash. The guard that enforces it | `pricingParity`, `honesty` tests |
| 29 | 10-05 | What broke this month, in one list | ops heartbeat flips, PR fix commits |
| 30 | 10-06 | Thirty posts: what changed in stars, installs, keys created. Only if measured | GitHub API, D1 counts on the day |

## Standing rules

- No download, revenue, or usage number until one is measured that day.
- "0.1.1 approved" only after `asc versions list` says READY_FOR_SALE.
- Nothing claims the agent submits, releases, or starts an experiment.
- A drafted thread lives in this folder with a Receipts section before it is
  posted. #567 is the loop that drafts them; until it exists, a session does.
