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

/** The single distinct value across rows, or null when they differ. */
function shared<T>(rows: LocaleRecommendation[], pick: (r: LocaleRecommendation) => T): T | null {
  if (rows.length < 2) return null;
  const seen = new Set(rows.map(pick));
  return seen.size === 1 ? pick(rows[0]!) : null;
}

export function LocalizationExpansionCard({ recommendations }: { recommendations: LocaleRecommendation[] }) {
  if (recommendations.length === 0) return null;
  /**
   * #388: state a tier/effort shared by EVERY row once, and give the freed space
   * to the per-locale rationale.
   *
   * On a real run (Heathen, 7dd8ee24) all 7 recommendations were large/translate,
   * so this card printed "large market" seven times and "translate existing copy"
   * seven times — fourteen chips carrying two facts. Meanwhile `rationale`, the
   * one field that differs per locale ("German-speaking audiences across DACH",
   * "Japanese-speaking audiences", …), was not rendered at all: the card repeated
   * what every row shares and dropped what made each row worth reading.
   *
   * When tier or effort genuinely vary the chips stay per row — collapsing those
   * would misreport a locale, which matters more than the density win.
   */
  const sharedTier = shared(recommendations, (r) => r.storefrontTier);
  const sharedEffort = shared(recommendations, (r) => r.effort);
  return (
    <div className="card" data-testid="localization-expansion-card">
      <b>Markets to expand into</b>
      <p className="micro muted" data-testid="loc-rationale" style={{ margin: "2px 0 8px" }}>
        ROI-sorted locales you don’t list in yet — translate your existing copy to claim them.
        A market-size heuristic, not live install data.
      </p>
      {sharedTier || sharedEffort ? (
        <p className="micro muted" data-testid="loc-shared-labels" style={{ margin: "0 0 8px" }}>
          {[
            sharedTier ? `All ${TIER_LABEL[sharedTier]}` : null,
            sharedEffort
              ? sharedEffort === "translate"
                ? "translate existing copy"
                : "net-new metadata"
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
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
            {sharedTier ? null : (
              <span className="micro muted loc-tier">{TIER_LABEL[r.storefrontTier]}</span>
            )}
            {sharedEffort ? null : (
              <span className="micro muted loc-effort">
                {r.effort === "translate" ? "translate existing copy" : "net-new metadata"}
              </span>
            )}
            {/* The distinguishing detail, shown only where the repeated chips
                are not competing with it for the row. */}
            {sharedTier && sharedEffort ? (
              <span className="micro muted loc-why">{r.rationale}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
