/**
 * /keywords — the fleet-wide keyword index (#356). A row is a keyword × app ×
 * storefront pair, because a rank belongs to one app in one storefront.
 */
import { PortfolioKeywordsView } from "../features/portfolioKeywords/PortfolioKeywordsView.js";
import { client } from "../api.js";

export function PortfolioKeywordsRoute() {
  return <PortfolioKeywordsView client={client} />;
}
