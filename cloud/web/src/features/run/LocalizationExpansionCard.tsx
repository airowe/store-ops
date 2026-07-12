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

export function LocalizationExpansionCard({ recommendations }: { recommendations: LocaleRecommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <div className="card" data-testid="localization-expansion-card">
      <b>Markets to expand into</b>
      <p className="micro muted" style={{ margin: "2px 0 0" }}>
        ROI-sorted locales you don’t list in yet — a market-size heuristic, not live install data.
      </p>
      {recommendations.map((r) => (
        <div key={r.locale} className="loc-rec-row" data-testid={`loc-rec-${r.locale}`} style={{ margin: "10px 0" }}>
          <p style={{ margin: 0 }}>
            <b>{r.locale}</b>
            <span className="micro muted" style={{ marginLeft: 8 }}>{TIER_LABEL[r.storefrontTier]}</span>
            <span className="micro muted" style={{ marginLeft: 8 }}>
              {r.effort === "translate" ? "translate existing copy" : "net-new metadata"}
            </span>
          </p>
          <p className="micro" style={{ margin: "2px 0 0" }}>{r.rationale}</p>
        </div>
      ))}
    </div>
  );
}
