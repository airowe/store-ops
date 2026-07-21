# CPP Part 2 — AI-designed per-intent CPP sets (#154)

## What's already built (verified)

- **Part 1** (#154 Part 1, shipped): `clusterKeywordIntents(keywords) -> KeywordIntent[]` (`cppIntents.ts`) — deterministic greedy clustering of tracked keywords into named intents (`{ label, keywords[] }`); `cppScreenshotDiff.ts` (identical-to-default detection); CPP findings in `auditFindings.ts`.
- **ShipShots** (#153, shipped): `planScreenshots(inputs: PlannerInputs, reasoner?)` → `ScreenshotPlan` with all guardrails (headline lint, MISSING gaps, template/accent whitelist, deterministic fallback). `PlannerInputs = { appName, subtitle?, keywords, rawScreens, audit: { grade, recommendedCount, findings }, brandPalette }`. The plan→render bridge (`lib/shipshots_render.py`) turns a plan into pixels locally.

## The gap this builds

Nothing connects Part 1's **intents** to ShipShots' **planner** to produce a *set of plans, one per intent* — the paid "generate a CPP set" feature. Part 2 is that bridge + its product surface. Steps 1 (cluster) and 3 (render) already exist; this builds **step 2** (per-intent plan) and the **orchestration** (steps 1→2 wired, behind the approval gate).

## Decision / scope

A **pure engine bridge** (`cppSets.ts`) + an **API route** that returns proposed CPP sets, read-only (the plan, not pixels — rendering stays the local ShipShots CLI, matching "nothing ships hosted"). **Creating the CPP record via the ASC API is explicitly out of scope for this PR** (it's a credentialed write with the same never-persist invariants, and it needs the ASC `appCustomProductPages` create path — a larger, separately-reviewed step). This PR delivers: intents → per-intent plans → a proposed, approval-gated set. That is the designed creative; the ASC create is a follow-up.

## Honesty invariants (carried from #153 + the issue)

- **Sparse-data floor:** if there aren't enough measured keywords to form ≥2 distinct intents, emit **"not enough measured keywords to propose CPPs"** — never guess intents from thin data (the issue's open question, answered).
- **Copy grounded in the audit** — each intent's plan is pitched at that intent, but headlines still pass the ShipShots lint (≤6 words, no unmeasured claims). No invented claims.
- **The LLM never paints pixels** — planner plans per intent; the deterministic renderer draws. Same posture as #153.
- **Approval-gated** — a CPP set is a *proposed* change; nothing is created until explicit approval (and even then, ASC create is a later PR).

## Component 1 — the bridge engine (pure, tested)

`cloud/src/engine/cppSets.ts`:

```ts
import type { KeywordIntent } from "./cppIntents.js";
import { clusterKeywordIntents } from "./cppIntents.js";
import { planScreenshots, type PlannerInputs, type ScreenshotPlan, type Grade, type Reasoner } from "./screenshotPlanner.js";

export type CppSetInputs = {
  appName: string;
  subtitle?: string;
  /** the tracked keywords to cluster into intents. */
  keywords: string[];
  rawScreens: string[];
  auditGrade: Grade;
  /** the audit's screenshot findings — carried into each intent's plan. */
  findings: string[];
  brandPalette: string[];
  recommendedCount: number;
};

export type CppSet = {
  intent: KeywordIntent;              // the named intent + its keywords (the evidence)
  plan: ScreenshotPlan;               // the ShipShots plan pitched at this intent
};

export type CppSetsResult =
  | { ok: false; reason: string }     // sparse-data floor: not enough to propose
  | { ok: true; sets: CppSet[]; intentsMeasured: number };

/** Min distinct intents (each with ≥MIN_KEYWORDS_PER_INTENT) before we propose. */
export const MIN_INTENTS = 2;
export const MIN_KEYWORDS_PER_INTENT = 2;

/**
 * Cluster keywords → per-intent ShipShots plans. Each intent's PlannerInputs
 * carries THAT intent's keywords (so the narrative is pitched at it) + the shared
 * audit grade/findings/brand. Returns the sparse-data refusal when there aren't
 * ≥MIN_INTENTS intents that each clear MIN_KEYWORDS_PER_INTENT — never a guessed
 * set. Pure over the injected reasoner (deterministic fallback without one).
 */
export async function buildCppSets(inputs: CppSetInputs, reasoner?: Reasoner): Promise<CppSetsResult>;

/** Turn one intent into PlannerInputs (the per-intent planner call's grounding). */
export function intentToPlannerInputs(intent: KeywordIntent, inputs: CppSetInputs): PlannerInputs;
```

- `buildCppSets`: cluster → filter to intents with ≥`MIN_KEYWORDS_PER_INTENT` → if `< MIN_INTENTS`, return `{ ok:false, reason }`. Else `planScreenshots` per intent (over the same injected reasoner), returning one `CppSet` each. Failures of a single intent's plan degrade to that intent's deterministic plan (ShipShots already does this) — the set is never partial-with-a-hole.
- `intentToPlannerInputs`: maps `intent.keywords` → `PlannerInputs.keywords`, carries `appName/subtitle/rawScreens/auditGrade/findings/brandPalette`, `recommendedCount`.

## Component 2 — the API route

`POST /cpp/sets` in `cloud/src/api/index.ts` — mirrors the `/plan/screenshots` route (stateless, returns the sets, renders/ships nothing, degrades without an AI binding). Body: `{ appName, subtitle?, keywords[], rawScreens?, auditGrade?, findings?, brandPalette?, recommendedCount? }`. Returns `CppSetsResult`. Non-string/empty appName → 400; the sparse-data refusal is a normal `{ ok:false }` 200 (it's a valid answer, not an error).

## Component 3 — shared type + (light) product surface

- `@shipaso/api`: add `CppSet` / `CppSetsResult` types + a `buildCppSets(client, inputs)` endpoint (mirrored into mobile types like the ShipShots ones).
- **Web card** `CppSetsCard` on the run detail (read-only, TDD): a "Generate CPP set" button → `POST /cpp/sets`; renders each intent (label + its keywords as the evidence), the plan's narrative + per-shot headlines/templates, MISSING/needs-review flags, the verbatim draft label; and the sparse-data refusal line when `ok:false`. Gated on the run having tracked keywords + a screenshot audit. (Mobile card optional/follow-up — keep this PR focused; web is where the paid-feature funnel lives.)

## Testing

- `cppSets.spec.ts`: intent→PlannerInputs mapping (this intent's keywords carried); sparse-data floor (1 intent, or thin keywords → `ok:false` with reason); ≥2 intents → one plan per intent, each plan's inputs reflect its own keywords; per-intent plan carries the shared audit findings; deterministic fallback path (no reasoner) still yields a set; empty keywords → refusal.
- Route spec: 400 on bad appName; sparse → `{ok:false}` 200; happy path returns sets.
- `CppSetsCard.test.tsx` (web vitest): renders intents+evidence, plan shots, sparse refusal, verbatim label, MISSING/needs-review.

## Out of scope (explicit)

- **ASC CPP create** (`appCustomProductPages` write) — a credentialed write with never-persist invariants; separate reviewed PR. This PR proposes the set; it does not create the page.
- Localization multiplier (intents × locales) — the bridge is locale-agnostic; wiring N-locale plans is a follow-up (same as #153's).
- CPP analytics readback ("proved" vs "shipped") — the issue's other open question; needs the create path first.
- Pixel rendering / upload — stays the local ShipShots CLI.
- Mobile CppSetsCard — web-first; mobile is a fast follow.
