/**
 * Propose a Product Page Optimization treatment (#182 Phase 3, read-only slice).
 *
 * The issue's Phase 3 is a WRITE lane: generate an outcome-led screenshot set →
 * approve → create the experiment + treatment + upload screenshots via the
 * stored key. Two of those pieces don't exist yet — AI screenshot generation
 * (ShipShots #153/#154) and an ASC screenshot-UPLOAD flow — and creating an
 * experiment is an outward write to a real Apple account. So this ships the
 * honest, unblocked half: a concrete treatment BRIEF the user runs themselves in
 * App Store Connect. No outward write, no invented assets.
 *
 * Honesty, load-bearing:
 *   • the plan is a RECOMMENDATION, never a claim about your numbers,
 *   • the conversion figure is a CITED public PPO result, not our metric,
 *   • the social-proof step names your MEASURED rating only when we actually read
 *     one (else a generic "add a social-proof slide"), never a fabricated star,
 *   • we only propose a test when NONE is running — if one is live we stay quiet
 *     (Phase 2's finding already says "don't judge it early").
 *
 * Pure + deterministic: no fetch, no Date.now, no randomness.
 */
import type { AscExperimentsResult } from "./ascExperiments.js";
import { isRunning } from "./ppoFindings.js";

/** A concrete, ready-to-run PPO treatment recommendation. */
export type PpoTreatmentPlan = {
  /** one-line what-to-test. */
  headline: string;
  /** ordered, concrete steps to set the experiment up in App Store Connect. */
  steps: string[];
  /** the cited public PPO evidence (never our own metric). */
  evidence: string;
  /** the ~90-day / confidence-threshold guidance so no one judges it early. */
  guidance: string;
  /** deep link to the app's App Store Connect page to set the test up, when known. */
  ascUrl?: string | undefined;
};

const EVIDENCE =
  "Public Product Page Optimization tests have measured large conversion swings from screenshot-only changes " +
  "(roughly 2–7x in reported cases) — leading with the outcome rather than the feature.";
const GUIDANCE =
  "Let the test run up to ~90 days and reach Apple's confidence threshold before you read the result — an early number is not a verdict.";

/** The social-proof step, naming the MEASURED rating only when we actually read one. */
function socialProofStep(ratingAverage: number | null | undefined): string {
  return typeof ratingAverage === "number" && ratingAverage > 0
    ? `Add a closing social-proof slide — your ${ratingAverage.toFixed(1)}★ App Store rating is a trust signal that lifts conversion.`
    : "Add a closing social-proof slide (your rating, an award, or press) — a trust signal that lifts conversion.";
}

/**
 * Build a treatment plan, or null when we shouldn't propose one:
 *   • no successful experiments read (keyless run or a degraded read) → null
 *     (we never propose a test we couldn't confirm the app isn't already running),
 *   • a test IS running → null (don't distract from the live one).
 * Otherwise (read OK, nothing running) → a concrete outcome-led treatment brief.
 */
export function buildPpoTreatmentPlan(input: {
  experiments?: AscExperimentsResult | undefined;
  ratingAverage?: number | null | undefined;
  trackId?: string | undefined;
}): PpoTreatmentPlan | null {
  const exp = input.experiments;
  if (!exp || !exp.read) return null; // only a confirmed read licenses a proposal
  if (exp.experiments.some(isRunning)) return null; // a test is live — stay quiet

  const plan: PpoTreatmentPlan = {
    headline: "Run a free A/B test: an outcome-led screenshot treatment",
    steps: [
      "Duplicate your current screenshots as the treatment, then change ONLY the captions/order so the test isolates the copy.",
      "Rewrite the FIRST screenshot's caption around the outcome the user gets — the result, not the feature. It's your search-results frame, so it must work as a standalone ad.",
      socialProofStep(input.ratingAverage),
      "Split traffic evenly and keep every other listing element identical to the control.",
    ],
    evidence: EVIDENCE,
    guidance: GUIDANCE,
  };
  if (input.trackId) plan.ascUrl = `https://appstoreconnect.apple.com/apps/${input.trackId}/distribution`;
  return plan;
}
