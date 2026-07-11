/**
 * Product Page Optimization findings (#182 Phase 2) — turns the READ experiment
 * list (ascExperiments.ts) into at most one honest finding. Pure + deterministic:
 * no fetch, no Date.now, no randomness — same input → identical output.
 *
 * Honesty, load-bearing:
 *   • MEASURED-OR-ABSENT: a DEGRADED read (couldn't list experiments) emits
 *     NOTHING — we never infer "you've never tested" from a permission failure.
 *   • the running fact quotes Apple's OWN startDate verbatim and cites the
 *     ~90-day / confidence-threshold guidance so nobody reads an early result as
 *     a win or a loss. "Running" is stated as running, never an implied outcome.
 *   • no invented metrics — experiment RESULT numbers (impressions/conversion/
 *     confidence) are NOT read here (that's a later phase); this lens is purely
 *     "have you tested, and is one running."
 */
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";
import type { AscExperimentsResult, PpoExperiment } from "./ascExperiments.js";

const SURFACE = "ppo";

/** Terminal experiment states — the test has ended, nothing is running. */
const ENDED_STATES = new Set(["COMPLETED", "STOPPED"]);

/** A running experiment: Apple flagged it started and it isn't in a terminal state. */
export function isRunning(exp: PpoExperiment): boolean {
  if (exp.started !== true) return false;
  return !(exp.state !== undefined && ENDED_STATES.has(exp.state.toUpperCase()));
}

/**
 * At most one PPO finding:
 *   • read degraded → [] (never a fabricated "never tested"),
 *   • a test is RUNNING → a status/context fact quoting Apple's start date + the
 *     don't-judge-early guidance,
 *   • no test has ever run (read OK, zero rows) → the free-A/B-test opportunity,
 *   • tests ran before but none is running now → the same opportunity, worded to
 *     acknowledge the history.
 */
export function ppoFindings(result: AscExperimentsResult | undefined): Finding[] {
  // Absent surface (keyless run) or a degraded read → silent. Only a SUCCESSFUL
  // read licenses either the "never tested" or "one is running" fact.
  if (!result || !result.read) return [];

  const running = result.experiments.filter(isRunning);
  if (running.length > 0) {
    const first = running[0]!;
    const since = first.startDate ? ` (running since ${first.startDate})` : "";
    const named = first.name ? ` “${first.name}”` : "";
    return [
      mk({
        id: "ppo_experiment_running",
        surface: SURFACE,
        severity: "info",
        impact: "conversion",
        title: "A product page test is running",
        detail:
          `Your Product Page Optimization test${named}${since} is live. Apple recommends letting a ` +
          `test run up to ~90 days and reaching its confidence threshold before you read the result — ` +
          `don't judge it early. Running is running, not a win or a loss.`,
        fix: "Let the test reach Apple's confidence threshold (up to ~90 days) before you act on it.",
        evidence: first.state ? `state: ${first.state}` : undefined,
        context: true,
      }),
    ];
  }

  const everTested = result.experiments.length > 0;
  return [
    mk({
      id: everTested ? "ppo_no_active_experiment" : "ppo_never_tested",
      surface: SURFACE,
      severity: "info",
      impact: "conversion",
      title: everTested
        ? "No product page test is running right now"
        : "You've never run a product page test — and it's free",
      detail: everTested
        ? "You've run a Product Page Optimization test before, but none is live now. PPO is Apple's own " +
          "free A/B test of your default product page — public tests have measured large conversion swings " +
          "from screenshot-only changes. Starting another is a low-risk way to keep improving."
        : "Product Page Optimization is Apple's own free A/B test of your default product page — you change " +
          "screenshots, order, or the icon and Apple splits real traffic and measures conversion for you. " +
          "Public tests have measured large conversion swings from screenshot-only changes. You've left this " +
          "free lever untouched.",
      fix: "Set up a Product Page Optimization test in App Store Connect — start with an outcome-led first screenshot.",
    }),
  ];
}
