/**
 * App Store Connect deep links for audit findings — #324 Tier 1.
 *
 * A finding that ends in "→ do X in App Store Connect" hands the customer
 * homework: they still have to know where in ASC that setting lives and navigate
 * there. This maps a finding id to the ASC page for THEIR app so the instruction
 * becomes a link.
 *
 * HONESTY, LOAD-BEARING — the whole reason this is an allowlist and not a
 * template:
 *   Apple does NOT document the App Store Connect *web console's* route
 *   structure. It's a private SPA and its paths can change without notice.
 *   Guessing a plausible-looking sub-route (`/distribution/pricing`,
 *   `/distribution/iaps`, `/distribution/info`, …) would produce a link that
 *   looks authoritative and 404s — strictly worse than no link, and exactly the
 *   kind of fabrication this product refuses.
 *
 *   So we emit ONLY the two app-scoped console paths this codebase can actually
 *   stand behind:
 *     • `/apps/{id}/appstore`     — the app's App Store listing area. Confirmed
 *       on the Apple Developer Forums as the direct per-app console URL.
 *     • `/apps/{id}/distribution` — the distribution area. Already shipped and
 *       exercised in this repo (`ppoTreatment.ts`, `ppoResults.ts`).
 *
 *   Every other finding falls back to the GENERIC console URL. That is an honest
 *   "we'll get you to App Store Connect, you'll find the section", not a broken
 *   promise of precision we don't have. When a route is later verified against a
 *   live console, add it here — never inline a guess at the call site.
 *
 * Pure + deterministic: no fetch, no Date.now, no randomness.
 */

/** The honest fallback: App Store Connect, no app scope, no invented section. */
export const ASC_GENERIC_URL = "https://appstoreconnect.apple.com";

const ASC_ROOT = "https://appstoreconnect.apple.com/apps";

/**
 * The ONLY app-scoped console areas we will link to. Adding a member here is a
 * claim that the route has been verified — treat it as such.
 */
type AscArea = "appstore" | "distribution";

/**
 * Finding id → the verified ASC area that finding is acted on in.
 *
 * Findings absent from this map deliberately get the generic link. Absence means
 * "we haven't verified where this lives", which is a fine thing to admit.
 */
const AREA_BY_FINDING: Record<string, AscArea> = {
  // ── the App Store listing area (name/subtitle/keywords, privacy, category) ──
  privacy_policy_missing: "appstore",
  secondary_category_missing: "appstore",
  category_mismatch: "appstore",
  age_rating_missing: "appstore",
  locale_incomplete: "appstore",
  subtitle_missing: "appstore",
  keywords_missing: "appstore",
  screenshots_no_ipad: "appstore",
  preview_missing: "appstore",
  preview_thin_coverage: "appstore",
  preview_error_state: "appstore",
  version_no_draft: "appstore",

  // ── the distribution area (experiments/PPO, custom product pages, pricing) ──
  ppo_never_tested: "distribution",
  ppo_no_active_experiment: "distribution",
  ppo_experiment_running: "distribution",
  ppo_result_measured: "distribution",
  cpp_none: "distribution",
  cpp_identical_to_default: "distribution",
  iap_not_promoted: "distribution",
};

/**
 * The App Store Connect URL for a finding, scoped to this app when we can.
 *
 * Returns `ASC_GENERIC_URL` — never a guess — when the app id is unknown or the
 * finding has no verified area. Callers should render the link either way; the
 * difference is only how precisely it lands.
 */
export function ascDeepLink(findingId: string, trackId: string | undefined): string {
  if (!trackId) return ASC_GENERIC_URL;
  const area = AREA_BY_FINDING[findingId];
  if (!area) return ASC_GENERIC_URL;
  return `${ASC_ROOT}/${encodeURIComponent(trackId)}/${area}`;
}

/** True when the URL is app-scoped (as opposed to the generic console link). */
export function isAppScoped(url: string): boolean {
  return url.startsWith(`${ASC_ROOT}/`);
}
