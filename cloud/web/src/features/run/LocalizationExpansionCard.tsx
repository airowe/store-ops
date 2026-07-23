/**
 * "Markets to expand into" — ROI-sorted localization recommendations (PRD 04),
 * ported into the redesigned run view. Present only on a keyed run that read the
 * live locale set; the server already computes + serves these on the run result.
 *
 * Honesty, load-bearing:
 *   • the rationale is a market/language DESCRIPTOR, never a fabricated install
 *     or revenue number (the heuristic is static + bundled, not live data),
 *   • effort is labelled honestly: "translate" (existing copy) vs "new" (net-new).
 * Pure presentational; data arrives from the run detail response.
 */
import type { LocaleRecommendation, StorefrontTier } from "@shipaso/api";

const TIER_LABEL: Record<StorefrontTier, string> = {
  large: "large market",
  mid: "mid market",
  "long-tail": "long-tail",
};

const TIER_SIZE: Record<StorefrontTier, number> = { large: 100, mid: 60, "long-tail": 30 };

export function LocalizationExpansionCard({ recommendations }: { recommendations: LocaleRecommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <div className="card" data-testid="localization-expansion-card">
      <b>Markets to expand into</b>
      <p className="micro muted" data-testid="loc-rationale" style={{ margin: "2px 0 8px" }}>
        ROI-sorted locales you don’t list in yet — translate your existing copy to claim them.
        A market-size heuristic, not live install data.
      </p>
      <div className="loc-table">
        {recommendations.map((r) => (
          <div key={r.locale} className="loc-row" data-testid={`loc-rec-${r.locale}`}>
            <span className="loc-code">{r.locale}</span>
            <span className="loc-size">
              <span
                className="loc-size-fill"
                data-testid={`loc-bar-${r.locale}`}
                style={{ width: `${TIER_SIZE[r.storefrontTier]}%` }}
              />
            </span>
            <span className="micro muted loc-tier">{TIER_LABEL[r.storefrontTier]}</span>
            <span className="micro muted loc-effort">
              {r.effort === "translate" ? "translate existing copy" : "net-new metadata"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
