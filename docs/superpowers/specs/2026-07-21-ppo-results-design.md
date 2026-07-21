# PPO Phase 4 — measured-conversion results surface (#182)

## What's built (verified)

- **Phase 1** — `captionLens.ts` (feature-led vs outcome-led caption classification + missing social-proof lens).
- **Phase 2** — `ascExperiments.ts` `readAscExperiments` reads the app's PPO experiments + **state** (PREPARE/IN_REVIEW/ACCEPTED/COMPLETED/STOPPED), `started`, `startDate`, `endDate`, `trafficProportion`. `ppoFindings.ts` turns those into the "never tested" / "running since <date>" findings — with the ~90-day/confidence guidance so nobody judges early.
- **Phase 3** — `ppoTreatment.ts` `buildPpoTreatmentPlan` (the proposed outcome-led treatment brief).

`ppoFindings.ts` states explicitly: *"result metrics (impressions, conversion, confidence) are NOT read here — that's a later phase."* **That later phase is this work.**

## Decision (from scoping): robust-to-both engine

The issue's open question — *are PPO result metrics readable via the ASC v2 API, or UI-only?* — is unresolved, and I won't guess Apple's exact current schema. So Phase 4 is built to be **correct either way**:

- a **pure results mapper** that, given a treatment's metric attributes, produces a verbatim, honestly-framed result **when they're present**, and
- a reader that fetches per-experiment treatment metrics but **degrades to a "view your results in App Store Connect" deep-link** (plus the 90-day/confidence guidance) when the metrics resource is absent / 403 / 404 / empty.

Either way the user gets an honest surface; nothing depends on the metrics endpoint existing. The reader carries a **NEEDS-LIVE-VALIDATION** note (like `asaClient.ts`) because the exact metrics attribute names are unverified against a live PPO test.

## Honesty invariants (load-bearing)

- **Apple's numbers verbatim, never ours.** A confidence score is quoted as *Apple's* confidence; a conversion rate is labeled `source: "apple-ppo"`. We never compute or restate a "win."
- **Running is running.** An experiment that hasn't reached Apple's confidence threshold (or ~90 days) is surfaced as *in progress* with the guidance, never an implied outcome — same rule Phase 2 already enforces.
- **Measured or absent.** No metrics read → the deep-link + guidance, never a fabricated or zero metric. A degraded read is distinct from "no result yet."
- **Read-only.** GET only; the JWT is per-request, never logged/persisted/returned (mirrors `ascExperiments`).

## Component 1 — the results mapper (pure, tested)

`cloud/src/engine/ppoResults.ts`:

```ts
/** A treatment's measured metrics as read from ASC — every field optional; a
 *  missing metric is absent, never a fabricated 0. */
export type PpoTreatmentMetrics = {
  treatmentId: string;
  treatmentName?: string;
  impressions?: number;
  conversionRate?: number;   // Apple's, 0..1 — quoted, never computed by us
  confidence?: number;       // Apple's confidence, 0..1 — verbatim
};

export type PpoResult = {
  experimentId: string;
  /** Apple's own state, verbatim. */
  state?: string;
  /** true when Apple's confidence cleared its own threshold (see CONFIDENCE_THRESHOLD). */
  reachedConfidence: boolean;
  /** control vs treatments, whatever metrics Apple exposed (may be empty). */
  treatments: PpoTreatmentMetrics[];
  /** the honest headline: "measured" (metrics present) | "running" | "no-metrics". */
  status: "measured" | "running" | "no-metrics";
  /** a deep link into ASC for this experiment, always present as the fallback. */
  ascUrl: string;
  /** the verbatim guidance line (90-day / confidence). */
  guidance: string;
};

export const CONFIDENCE_THRESHOLD = 0.9; // Apple surfaces significance around 90%

export function mapTreatmentMetrics(row: unknown): PpoTreatmentMetrics | null;

/** Fold an experiment + its treatment metrics into an honest PpoResult. When no
 *  metric is present → status "no-metrics" + the deep link (never a fake number).
 *  When present but confidence < threshold → "running". Else "measured". */
export function buildPpoResult(args: {
  experimentId: string;
  state?: string;
  appId: string;
  treatments: PpoTreatmentMetrics[];
}): PpoResult;

/** ASC deep link for an experiment (the always-available fallback CTA). */
export function experimentAscUrl(appId: string, experimentId: string): string;
```

- Pure, deterministic, no network — unit-tested with fixture rows: metrics present → `measured` (+ verbatim rate/confidence), confidence below threshold → `running`, no metrics → `no-metrics` + deep link, a garbage/absent metric coerces to absent (never 0).

## Component 2 — the reader (degrade-safe, NEEDS-LIVE-VALIDATION)

`ppoResults.ts` `readPpoResults(fetchFn, { token, appId, experiments })`:

- For each experiment, GET its treatments + any metrics resource under `appStoreVersionExperimentsV2/{id}` (the exact sub-path is the unverified bit → NEEDS-LIVE-VALIDATION comment).
- Any non-OK (403/404/empty) → that experiment folds to a `no-metrics` `PpoResult` (deep link + guidance), **never throws**, mirroring `readAscExperiments`' degrade posture.
- Returns `{ results: PpoResult[]; read: boolean; note? }`.

## Component 3 — the honesty surface

- Extend `ppoFindings.ts` (or a sibling `ppoResultFindings.ts`): for a `measured` result, a finding that **quotes Apple's conversion rate + confidence verbatim** ("Apple measured X% conversion on the treatment vs Y% control, at Z% confidence — Apple's numbers"). For `running` / `no-metrics`, the existing "let it reach confidence / view in ASC" guidance with the deep link. Reuses the `Finding` shape → lands on the existing findings card (no new UI required).
- Wire `readPpoResults` into `ascRead.ts` alongside `readAscExperiments` (keyed runs only), and thread the results onto the run result the same way experiments are.

## Testing

- `ppoResults.spec.ts`: `mapTreatmentMetrics` (present → mapped, absent/garbage → null/absent, never 0); `buildPpoResult` (measured / running / no-metrics classification, verbatim rate+confidence carried, deep link always present, confidence-threshold boundary); `experimentAscUrl` shape; `readPpoResults` with a fake FetchLike (metrics present → measured; 403/404/empty → no-metrics degrade, never throws; `read:false` note on degrade).
- Finding-copy test: a measured finding quotes Apple's numbers + labels them Apple's; a running/no-metrics finding carries the guidance + deep link and NO fabricated metric.

## Out of scope (explicit)

- **Phase 3 write lane** (create experiment + upload treatment screenshots) — already the ShipShots/CPP generation seam + a credentialed ASC write; separate.
- Confirming Apple's exact metrics attribute names against a live PPO test — the NEEDS-LIVE-VALIDATION note flags this; the mapper is written tolerantly so a name mismatch degrades to `no-metrics` (deep link), never a wrong number.
- Any new dedicated results UI — rides the existing findings card.
