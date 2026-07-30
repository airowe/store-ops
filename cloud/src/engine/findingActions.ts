/**
 * Attach ACTIONS to findings — #324, the "don't hand out homework" pass.
 *
 * The pattern the issue names: a finding correctly diagnoses an opportunity and
 * then punts the customer out of ShipASO with "→ do X in App Store Connect".
 * That's an instruction, not an action — the customer still has to know where in
 * ASC the setting lives and navigate there.
 *
 * This decorates each actionable finding with:
 *   • Tier 1 — a deep link into the app's OWN App Store Connect area, falling
 *     back to the generic console URL where we have no verified route (see
 *     `ascDeepLink.ts` for why that fallback is a feature, not a shortfall).
 *   • Tier 2 — a handoff to an existing ShipASO builder, where one exists. The
 *     PPO finding continues into the screenshot-set planner; the Custom Product
 *     Page finding continues into the CPP set generator. This turns "you should
 *     run a test" into "here's the treatment to test."
 *
 * Tier 3 (do-it-from-here via approve→push) is deliberately NOT implemented
 * here. The issue names promoted IAPs as the candidate, but `ascWrite.ts` has no
 * promoted-IAP write path — it writes listing metadata localizations only. We do
 * not build a new outward write path to a customer's Apple account as a side
 * effect of a UX issue, so that finding gets Tier 1 + honest instructional copy.
 *
 * Pure + deterministic: no fetch, no Date.now, no randomness.
 */
import { ascDeepLink, isAppScoped } from "./ascDeepLink.js";
import type { Finding, FindingAction, FindingTool } from "./findings/core.js";

/**
 * Findings that continue into a builder ShipASO already ships. Keep this
 * conservative: a wrong handoff wastes the customer's click and erodes trust
 * more than no handoff does.
 */
const TOOL_BY_FINDING: Record<string, FindingTool> = {
  // "You've never run a product page test — and it's free" → plan the
  // screenshot set to actually test (#324's named Tier 2 case).
  ppo_never_tested: "screenshots",
  ppo_no_active_experiment: "screenshots",
  // "No Custom Product Pages" → generate the per-intent CPP sets.
  cpp_none: "cpp",
  cpp_identical_to_default: "cpp",
};

/** Link text per area — server-authored so the UI never invents a claim. */
function labelFor(appScoped: boolean): string {
  return appScoped ? "Open in App Store Connect →" : "Go to App Store Connect →";
}

/**
 * Decorate one finding with its action, or leave it untouched.
 *
 * A finding with NO fix is a healthy check or a pure status fact — there is
 * nothing to act on, so it gets no action (an action there would manufacture a
 * task that doesn't exist).
 */
export function withAction(finding: Finding, trackId: string | undefined): Finding {
  if (finding.fix.trim() === "") return finding;

  const url = ascDeepLink(finding.id, trackId);
  const appScoped = isAppScoped(url);
  const action: FindingAction = { url, label: labelFor(appScoped), appScoped };

  const tool = TOOL_BY_FINDING[finding.id];
  if (tool) action.tool = tool;

  return { ...finding, action };
}

/** Decorate every finding in a list. Order and contents are otherwise unchanged. */
export function withActions(findings: Finding[], trackId: string | undefined): Finding[] {
  return findings.map((f) => withAction(f, trackId));
}
