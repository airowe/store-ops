# Studio tier — the grade-delta projection (#26)

## What #26 asked for, and what's now already built

#26 is a "Studio" premium tier that closes the screenshot half of the loop: audit grades your screenshots (B), then generate a better set, tie it to a "before grade → after grade" delta, gate behind a paid tier. It was explicitly parked pre-PMF because the *creative pipeline* was the risk.

**That pipeline now exists** (shipped this session):
- **Render**: ShipShots planner + `lib/shipshots_render.py` (#153) — device-frame captioned PNGs at App Store dimensions.
- **Audit-tied generation**: per-intent CPP sets (#154 Part 2) — sets designed against measured findings, not blind.
- **Copy**: the optimize-copy engine writes captions to limits; `screenshotScore.ts` grades sets and already computes **`shotLevers`** — quantified C→B→A levers, each with `fromGrade`/`toGrade`/`delta`, via the real `gradeFor`.

So #26's engine risk is gone. **The one on-brand piece still missing is the "before grade → after grade" projection** that ties a generated set to the proof story — "your screenshots are a B (72); this generated set addresses 2 of the 3 deficits → projected A (88)."

## Decision / scope

Build the **grade-delta projection** — a pure engine that, given the current `ShotScore` + which levers a generated set addresses, projects a **cumulative** after-grade, honestly framed as *projected from applying these fixes*, never promised. Surface it as a finding + on the generated-set response. This is the honest packaging #26 wanted; it deepens the existing loop rather than widening the surface.

**Explicitly NOT in scope** (correctly, per #26's own "post-revenue" gate): flipping on a new paid "Studio" Stripe tier / entitlement. The tier gate is a business decision tied to PMF signal; this PR builds the *capability + honesty surface* the tier would sell, leaving the price/gate to the owner. (The `billing.ts` tier-gate pattern is ready when that call is made.)

## Honesty rules

- **Projected, never promised.** The after-grade is what the grade model computes IF the addressed levers are applied — labeled "projected", with the driver levers shown. We never claim the set *will* rank or convert better.
- **Reuses the real grade model.** The projection runs through the SAME `gradeFor` + `shotLevers` the audit uses — a budget change that breaks the mapping fails CI. No parallel scoring.
- **No over-sell.** An A-grade / no-headroom set → no projection (`shotLevers` already returns [] there). A set that addresses nothing → "no projected grade change" (honest), never a fabricated bump.
- **Unreadable stays unreadable.** A "?"/null current grade → no projection (can't project from an unmeasured baseline).

## Component — the projection engine (pure, tested)

`cloud/src/engine/gradeProjection.ts`:

```ts
import { gradeFor, shotLevers, type Grade, type ShotScore, type Lever } from "./screenshotScore.js";

export type GradeProjection = {
  fromGrade: Grade;
  fromScore: number;
  /** the cumulative projected grade after the addressed levers. */
  toGrade: Grade;
  toScore: number;
  /** the levers this generated set addresses (a subset of shotLevers). */
  addressed: Lever[];
  /** true when there's a real projected improvement to show. */
  improved: boolean;
  /** the verbatim honesty caveat. */
  note: string;
};

/**
 * Project the grade a generated set would reach, from the CURRENT ShotScore and
 * the lever ids the set addresses. Cumulative: sums the addressed levers' deltas
 * (capped at 100), then `gradeFor` the result. Returns improved:false (no bump)
 * when the current grade is unreadable/A, or the set addresses no lever — never a
 * fabricated improvement.
 */
export function projectGrade(current: ShotScore, addressedLeverIds: Array<Lever["id"]>): GradeProjection;

/** Which levers a ShipShots/CPP set addresses, inferred honestly from the plan:
 *  a set that ships the recommended shot count addresses "count"; an iPad-inclusive
 *  set addresses "ipad"; a set at the target aspect addresses "aspect". Conservative
 *  — only claims a lever the plan actually satisfies. */
export function leversAddressedByPlan(plan: { shotCount: number; hasIpad: boolean; atTargetAspect: boolean }, current: ShotScore): Array<Lever["id"]>;
```

- `projectGrade`: filter `shotLevers(current)` to the addressed ids, sum their deltas (cap 100), `gradeFor` the total. `improved = toScore > fromScore`. Deterministic; unit-tested against fixture scores.
- `leversAddressedByPlan`: maps a generated plan's shape → the lever ids it genuinely satisfies (conservative — never claims a lever the plan doesn't meet).

## Surface

- `gradeProjection.ts` `gradeProjectionFinding(proj) -> Finding | null`: a finding — "Your screenshots grade <from> (<n>). This generated set projects <to> (<m>) by addressing: <levers>. Projected from the grade model if you ship it — not a promise." `impact: "conversion"`, `surface: "screenshots"`. Null when `!improved`.
- Optionally thread the projection onto the CPP-sets response (`buildCppSets`) so the paid-feature funnel shows the grade lift — but keep it a separate, optional field so the CPP engine stays focused. (This PR adds the engine + finding; wiring onto the response is a one-line follow-up if desired.)

## Testing

- `gradeProjection.spec.ts`: cumulative delta → correct `gradeFor`; addressing all levers reaches the ceiling grade; addressing none → improved:false (no bump); a "?"/null current → improved:false; A-grade current → improved:false (shotLevers empty); `leversAddressedByPlan` conservative mapping (only satisfied levers); the finding quotes both grades + carries the "projected, not a promise" caveat and lists the driver levers; `!improved` → null finding.

## Out of scope (explicit)

- A new paid "Studio" Stripe tier / entitlement gate — the owner's PMF-gated business call (`billing.ts` pattern ready). This builds the capability + honest surface, not the paywall.
- The render/upload itself — already ShipShots (#153) + the local CLI.
- Any claim the generated set *will* improve real conversion — projection is grade-model-only, explicitly labeled.
