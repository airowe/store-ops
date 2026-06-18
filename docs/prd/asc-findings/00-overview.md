# ASC Findings — PRD suite overview

> We READ 8 ASC surfaces and store them on the run (`result.ascSnapshot`), but
> only screenshots reach the UI. This suite turns the captured data into
> **scored, prioritized, actionable findings** that tell a user what to fix, why
> it helps installs/rank, and how. Split into focused PRDs so each phase is
> independently reviewable, testable, and shippable.

## The product principle

A finding, not a data dump. Every surface produces zero+ **Findings**:

```
Finding = {
  id, surface,                      // "preview_missing" from "previews"
  severity: "critical"|"warn"|"good"|"info",
  impact:   "ranking"|"conversion"|"trust"|"completeness",
  title, detail, fix,               // what / why-it-matters / the action
  evidence?                         // the data point ("0 of 3 device sizes")
}
```

Findings are sorted by **severity × impact** — biggest wins first. Each declares
its **impact lane** (ranking = get seen; conversion = get installed) so users
never conflate "I fixed screenshots" with "why didn't I rank."

## The flow change: ASC is the unlock

Without a `.p8`, the audit is necessarily thin (public data only). The findings
list is the **reward for connecting ASC** — a normal run shows a few findings +
"connect ASC to unlock your full audit"; a Mode-A run fills it all in. Honest
upsell toward the hosted product.

## The PRD suite (build order)

| PRD | Scope | Depends on |
|-----|-------|-----------|
| [`01-findings-engine.md`](./01-findings-engine.md) | Pure `auditFindings()` — all logic + thresholds, exhaustively unit-tested, no network. **The foundation.** | — |
| [`02-run-integration.md`](./02-run-integration.md) | Compute findings in the run path; thin set on no-key runs; serialize to the API (no raw data leak). | 01 |
| [`03-run-page-ui.md`](./03-run-page-ui.md) | The "Listing audit" card on the run page — grouped, labeled, actionable. | 02 |
| [`04-dashboard-and-unlock.md`](./04-dashboard-and-unlock.md) | Finding-count badge on app cards + the ASC-unlock CTA on no-key runs. | 02, 03 |
| [`05-surface-findings-spec.md`](./05-surface-findings-spec.md) | The exhaustive per-surface finding catalog (every rule, severity, copy). Reference for 01. | — (reference) |

## Sequencing rationale

- **01 first** — everything renders what the engine emits. Get the rules + scoring
  right in isolation (pure, no network) before any wiring.
- **02 next** — wire + serialize, with the privacy discipline (return findings, not
  raw pricing/locale).
- **03 then 04** — UI, then the funnel/upsell polish.
- **05 is a living reference** — the full rule catalog 01 implements; kept separate
  so the engine PRD stays about architecture, not 40 copy strings.

## Launch slice (if not all at once)

High-ROI subset shippable for launch: **privacy policy missing, no preview video,
no secondary category, single-locale** + the existing screenshot grade. These are
concrete, actionable, and span both impact lanes. Defer pricing/age-rating/custom-
pages findings (lower signal) to a fast-follow. PRD 05 marks each finding
`launch | fast-follow`.

## Hard constraints (carry across all PRDs)

- **Findings only to the client** — never raw ASC JSON; never full pricing/locale
  text. The full snapshot stays server-side in the DB trace.
- **`.p8` ephemeral** — unchanged; findings are computed from the already-read
  snapshot, no new ASC calls.
- **Don't over-assert** — low-signal surfaces (pricing, age rating) are `info`,
  never `critical`. Confident assertions off weak data is the #41 trap.
- **Graceful degradation** — a surface that failed to read contributes no findings
  (we already capture `snapshot.errors`); never crash the card.
- **No new outward writes.** Reads + presentation only.
