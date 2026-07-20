# RLHF Phase 2 — edit-delta analysis + acceptance metric (#96)

## State of #96 before this work

**Phase 1 (capture) is fully built and live-gated:**
- `cloud/src/engine/preferenceSignal.ts` — `buildPreferenceRows` produces one `EditRow` per editable field: `{ field, decision, edited, proposed, final }`, `edited` normalized so whitespace/case churn isn't counted.
- `cloud/src/crypto/rlhfCrypto.ts` — AES-256-GCM `encryptField`/`decryptField` + `importKeyFromBase64`.
- `proposal_edits` table (`cloud/schema.sql:330`) — **anonymous by construction** (no `user_id`, no `app_id`), `proposed_enc`/`final_enc` ciphertext at rest, `created_at datetime('now')`.
- Opt-out route `POST /account/rlhf-optout`, honored at write time.
- **Export route** `GET /admin/preference-data` (`cloud/src/api/index.ts:~1093`) — token-gated (`RLHF_EXPORT_TOKEN`), degrades **closed** (403 without token, 503 without key). Emits **JSONL**, one row per line:
  ```json
  {"field":"subtitle","decision":"approved","edited":true,"proposed":"...","final":"...","created_at":"2026-07-19 12:00:00"}
  ```

**What is NOT built (this work):** Phase 2 — anything that turns that exported JSONL into (a) edit **patterns** and (b) a before/after **acceptance metric**. Today the data is captured and exportable but nothing analyzes it.

## Decision (from scoping)

**Analysis + metric, no auto-apply.** Build the offline mining + the metric, surfaced as a report. Any prompt adjustment stays a **manual, human-reviewed** step — this honors the issue's honesty fence: *claim follows evidence, never precedes it*, and *nothing auto-changes the agent from anonymized aggregate data before the metric proves it helps*.

> Injection point, for the future manual step: `optimize.ts` is fully deterministic (no LLM prompt) — there is **nothing to inject there**. The only prompt seam is `keywordReasoner.buildPrompt` (`cloud/src/engine/keywordReasoner.ts:344`), whose rules block is a `[...].join("\n")` array a reviewed "preference adjustment" line could slot into. This work does not touch it.

## Where this runs

A **pure analysis library** (`cloud/src/engine/rlhfAnalysis.ts`) + a **local CLI** (`scripts/rlhf-analyze.mts`) that reads the export JSONL from **stdin or a file** and prints the report. This matches the PRD's "decrypted only in a trusted env": the operator runs the token-gated export, pipes the plaintext JSONL into the local analyzer — the analyzer never touches the Worker, D1, or the key. Same posture as the ShipShots renderer (analysis is local; nothing hosted changes).

```
GET /admin/preference-data  (token-gated, decrypts in-Worker) → export.jsonl   (operator, trusted env)
scripts/rlhf-analyze.mts    (pure; stdin/file → report)       → patterns + acceptance metric
[manual, reviewed]          patterns inform a prompt tweak                        (never automatic)
```

## Component 1 — the analysis engine (pure, unit-tested)

`cloud/src/engine/rlhfAnalysis.ts`. Input type mirrors the export row exactly:

```ts
export type PreferenceRow = {
  field: string;          // name|subtitle|keywords|promo|description|whatsNew
  decision: "approved" | "rejected";
  edited: boolean;
  proposed: string;
  final: string;
  created_at: string;     // "YYYY-MM-DD HH:MM:SS"
};
```

### (a) `analyzeEditPatterns(rows) -> EditPatternReport`

Per-field, correlational-only descriptive stats over the deltas — **never a causal claim**:
- **edit rate** — `edited / total` per field (how often humans change the agent here).
- **length drift** — mean signed `len(final) - len(proposed)` on edited rows (do humans shorten subtitles? lengthen descriptions?).
- **keyword-field churn** — for `field==="keywords"`, mean count of terms added / removed (comma-split), since that's the highest-signal field.
- **rejection rate** — `decision==="rejected" / total` per field.
- Every stat carries its **sample size**; a field under a `MIN_SAMPLE` threshold (default 30) is emitted with `sufficient: false` and no strong wording — "not enough data yet", never a pattern claimed off a handful of rows (directly answers the issue's open question).

### (b) `acceptanceMetric(rows, opts) -> AcceptanceMetricReport`

The **evidence bar** that licenses any public "learns from your edits" claim:
- Split rows into two windows by `created_at` — a `before` and `after` cutoff (opts: an ISO cutoff, or "median split" by default).
- Compute **edit rate** (and rejection rate) in each window, per field and overall.
- Report the **delta**: did proposals get edited *less* after the cutoff? `{ before, after, deltaPct, direction: "improved"|"worse"|"flat", sufficient }`.
- Honesty guards: refuse a verdict when either window is under `MIN_SAMPLE` (`direction:"insufficient"`); the metric **describes** the observed change, it does not attribute it to any intervention (there may be no intervention yet — the harness exists so that when a prompt tweak *is* made, the before/after is measurable).

Both functions are deterministic and pure — no LLM, no network, no D1 — so they unit-test in the fast vitest env with fixture rows.

## Component 2 — the CLI

`scripts/rlhf-analyze.mts` (tsx, like the existing `verify-asa-popularity.mts`):
```
npx tsx scripts/rlhf-analyze.mts < export.jsonl
npx tsx scripts/rlhf-analyze.mts --file export.jsonl --cutoff 2026-07-01
```
Parses JSONL (tolerant: skips blank/garbage lines with a counted warning, never crashes the run), calls both engine functions, prints a readable report: per-field patterns with sample sizes, the acceptance metric with its direction + the "insufficient data" honesty line where it applies. Prints nothing it can't support.

## Honesty invariants (carried)

- **Claim follows evidence** — the metric is the gate; the report never says "it learns", it reports whether edit rate moved and whether the sample is sufficient.
- **Correlational, sized** — every stat carries n; sub-threshold fields say "not enough data", never a confident pattern.
- **No de-anonymization** — the analyzer only ever sees the already-anonymous export rows (no user/app id exists to leak); it adds no join.
- **No auto-apply** — nothing in this work writes to `keywordReasoner.ts` or changes agent behavior. The spec records *where* a future reviewed adjustment would inject (`keywordReasoner.buildPrompt`), explicitly as a manual follow-up.

## Testing

- `cloud/src/engine/rlhfAnalysis.spec.ts` — fixtures: edit-rate math, length drift sign, keyword churn, rejection rate, `MIN_SAMPLE` gating (sub-threshold → `sufficient:false` + soft wording), acceptance before/after delta + direction, `insufficient` when a window is thin, empty input → empty report (no crash, no fabricated stat).
- CLI smoke: pipe a small fixture JSONL → asserts the report contains the field lines + the metric line (Node `--test` or a tsx smoke, guarded like other scripts).

## Out of scope (explicit)

- Auto-applied prompt tuning (the "full loop") — deferred by decision; the metric must show improvement first.
- Fine-tuning / model training — the PRD says prompt-level first; not this work.
- The owner secret-setting + prod verification (Phase 1 go-live) — an owner action, documented, not agent-buildable.
