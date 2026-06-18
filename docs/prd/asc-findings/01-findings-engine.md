# PRD 01 — Findings engine (`auditFindings`)

> The foundation. A **pure, deterministic, network-free** function that turns the
> ASC snapshot (+ existing audit/ranks) into a sorted `Finding[]`. All rules,
> thresholds, severities, and copy live here so they're exhaustively unit-tested
> with zero mocking of HTTP.

## Deliverable

`cloud/src/engine/auditFindings.ts`:

```ts
export type FindingSeverity = "critical" | "warn" | "good" | "info";
export type FindingImpact = "ranking" | "conversion" | "trust" | "completeness";

export type Finding = {
  id: string;            // stable, e.g. "privacy_policy_missing"
  surface: string;       // "appInfo" | "previews" | "screenshots" | ...
  severity: FindingSeverity;
  impact: FindingImpact;
  title: string;         // short, human ("No app preview video")
  detail: string;        // why it matters, plain language, 1–2 sentences
  fix: string;           // the concrete action to take
  evidence?: string;     // the data point, when it sharpens the point
};

export type AuditFindingsInput = {
  snapshot?: AscSnapshot;            // undefined on a no-key run
  audit: Audit;                      // existing (carries the screenshot ShotScore)
  ranks: Rank[];                     // existing rank data
  appName: string;
  hasAscKey: boolean;                // did this run read ASC? (drives the unlock CTA finding)
};

export function auditFindings(input: AuditFindingsInput): Finding[];
```

## Behavior contract

- **Pure**: no fetch, no Date.now, no randomness. Same input → same output.
- **Sorted**: by `severity × impact` weight, descending — biggest wins first.
  Weight table (engine-internal, tunable):
  - severity: critical=1000, warn=400, info=100, good=10
  - impact tiebreak: completeness/trust > conversion > ranking (a blocker beats a
    nice-to-have). Within equal severity, order by impact weight then by id (stable).
- **Graceful**: if `snapshot` is undefined or a surface is absent/errored, emit no
  findings for it (never throw). If `snapshot.errors` has an entry, optionally one
  `info` "couldn't read X" finding (off by default; flag-gated).
- **No-key path**: when `hasAscKey === false`, emit the public-only findings
  (screenshot grade if present) PLUS a single `info` `asc_unlock` finding whose
  `fix` is "Connect App Store Connect to unlock your full audit." (PRD 04 renders
  the CTA; the finding is the data hook.)
- **Don't over-assert**: pricing + age-rating findings cap at `warn` (usually
  `info`); never `critical`.

## Scoring helpers (also exported, also tested)

- `scoreFinding(severity, impact): number` — the sort weight.
- `summarizeFindings(findings): { critical, warn, good, info, total, topImpact }`
  — for the dashboard badge (PRD 04) and the card header.

## Rule catalog

The full per-surface rule set (every id, threshold, severity, copy) is specified
in [`05-surface-findings-spec.md`](./05-surface-findings-spec.md). This PRD owns
the **engine + scoring + sort + graceful/ no-key behavior**; PRD 05 owns the
**content of each rule**. Implement the rules from 05; structure from here.

## Testing (TDD — this PRD is ~all tests)

Exhaustive, table-driven, no network:
- Each rule fires on its triggering snapshot fixture and stays silent otherwise.
- Severity + impact assigned per the 05 spec.
- Sort order: a critical completeness finding precedes a warn conversion one;
  ties broken stably.
- No-key run → screenshot finding (if any) + exactly one `asc_unlock` info.
- Undefined snapshot / errored surface → no crash, no spurious findings.
- `summarizeFindings` counts correctly.
- **Determinism**: same input twice → identical array (deep-equal).

## Out of scope (later PRDs)

- Wiring into the run path / serialization → PRD 02.
- Any UI → PRD 03/04.
- New ASC reads — findings derive ONLY from the already-captured snapshot.

## Acceptance

- `auditFindings` is pure, returns a correctly-sorted `Finding[]`.
- Every rule in PRD 05 has a passing unit test (fires + stays-silent).
- No-key and degraded-snapshot paths are covered.
- tsc clean; no network in the spec.
