/**
 * Portfolio auto-detection — storefront-intel PRD 05
 * (`docs/prd/storefront-intel/05-portfolio-detection.md`).
 *
 * Every audited app's storefront page lists the seller's OTHER apps
 * (`moreByDeveloper`, persisted on the run trace since the intel seam). This
 * turns that into "we found N other apps by this seller — track them?" — the
 * cheapest possible multi-app activation lever, with zero extra fetches.
 *
 * Honest expansion: we only SUGGEST (never auto-track), and a missing shelf is
 * UNKNOWN (`known:false`), never zero — an unread page is indistinguishable
 * from a seller with genuinely no other apps, so we never assert either.
 *
 * Pure. No bindings, no fetch.
 */
import type { StorefrontApp } from "./storefrontListing.js";

export type PortfolioSuggestion = StorefrontApp;

export type PortfolioResult =
  /** The shelf was read; `[]` means everything on it is already tracked (or self). */
  | { known: true; suggestions: PortfolioSuggestion[] }
  /** The shelf was absent/unreadable — UNKNOWN, never presented as zero. */
  | { known: false };

/**
 * Filter the seller's shelf to apps the user isn't already tracking (and not the
 * audited app itself). Bundle ids compare case-insensitively. Suggestions pass
 * through verbatim — optional fields stay absent when the page didn't carry them.
 */
export function detectPortfolio(
  moreByDeveloper: StorefrontApp[] | undefined,
  trackedBundleIds: string[],
  selfBundleId: string,
): PortfolioResult {
  if (!moreByDeveloper) return { known: false };
  const exclude = new Set(
    [selfBundleId, ...trackedBundleIds].map((b) => b.toLowerCase()),
  );
  const suggestions = moreByDeveloper.filter(
    (app) => !exclude.has(app.bundleId.toLowerCase()),
  );
  return { known: true, suggestions };
}
