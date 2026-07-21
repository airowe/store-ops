/**
 * CPP sets (#154 Part 2) — the paid "generate a CPP set" feature: cluster a run's
 * tracked keywords into named intents (Part 1's clusterKeywordIntents), then run
 * the ShipShots planner (#153) ONCE PER INTENT so each Custom Product Page's
 * creative is pitched at its intent (trip-planner CPP leads with the timeline;
 * radar CPP leads with the map) rather than a generic set.
 *
 * Honesty, load-bearing:
 *   • SPARSE-DATA FLOOR — a CPP is only worth proposing if the app has ≥2 distinct
 *     measured intents; below that we refuse ("not enough measured keywords"),
 *     never a guessed set (the issue's open question, answered),
 *   • each intent's plan is grounded in THAT intent's own keywords + the shared
 *     audit findings — no invented claims (headlines still pass ShipShots' lint),
 *   • the LLM never paints pixels — this returns PLANS; the deterministic renderer
 *     draws them locally,
 *   • nothing is created — a set is a PROPOSAL behind the approval gate; the ASC
 *     CPP-create write is a separate, credentialed follow-up.
 *
 * Pure over an injected Reasoner (deterministic fallback without one), so it
 * unit-tests in the fast node env with no AI binding.
 */
import { clusterKeywordIntents, type KeywordIntent } from "./cppIntents.js";
import {
  planScreenshots,
  type Grade,
  type PlannerInputs,
  type Reasoner,
  type ScreenshotPlan,
} from "./screenshotPlanner.js";

/** Min distinct intents (each ≥MIN_KEYWORDS_PER_INTENT) before we propose a set. */
export const MIN_INTENTS = 2;
export const MIN_KEYWORDS_PER_INTENT = 2;

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
  /** the named intent + its keywords (the evidence the set is grounded in). */
  intent: KeywordIntent;
  /** the ShipShots plan pitched at this intent. */
  plan: ScreenshotPlan;
};

export type CppSetsResult =
  | { ok: false; reason: string }
  | { ok: true; sets: CppSet[]; intentsMeasured: number };

/** Turn one intent into the PlannerInputs for its per-intent ShipShots call. */
export function intentToPlannerInputs(intent: KeywordIntent, inputs: CppSetInputs): PlannerInputs {
  return {
    appName: inputs.appName,
    ...(inputs.subtitle !== undefined ? { subtitle: inputs.subtitle } : {}),
    keywords: intent.keywords,
    rawScreens: inputs.rawScreens,
    audit: {
      grade: inputs.auditGrade,
      recommendedCount: Math.max(1, inputs.recommendedCount),
      findings: inputs.findings,
    },
    brandPalette: inputs.brandPalette,
  };
}

/**
 * Cluster keywords → per-intent ShipShots plans. Returns the sparse-data refusal
 * when fewer than MIN_INTENTS intents each clear MIN_KEYWORDS_PER_INTENT — never a
 * guessed set. Otherwise one CppSet per qualifying intent, each plan grounded in
 * that intent's own keywords. A single intent's plan failure degrades to its
 * deterministic plan (planScreenshots already guarantees this), so the set is
 * never partial-with-a-hole.
 */
export async function buildCppSets(inputs: CppSetInputs, reasoner?: Reasoner): Promise<CppSetsResult> {
  const intents = clusterKeywordIntents(inputs.keywords).filter(
    (i) => i.keywords.length >= MIN_KEYWORDS_PER_INTENT,
  );

  if (intents.length < MIN_INTENTS) {
    return {
      ok: false,
      reason:
        "not enough measured keywords to propose CPPs — a Custom Product Page is only " +
        `worth creating per distinct intent, and this run has ${intents.length} intent(s) ` +
        `with ≥${MIN_KEYWORDS_PER_INTENT} tracked keywords (need ≥${MIN_INTENTS}). Track more ` +
        "keywords across distinct themes first.",
    };
  }

  const sets: CppSet[] = [];
  for (const intent of intents) {
    const plan = await planScreenshots(intentToPlannerInputs(intent, inputs), reasoner);
    sets.push({ intent, plan });
  }
  return { ok: true, sets, intentsMeasured: intents.length };
}
