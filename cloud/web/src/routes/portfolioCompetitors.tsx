/**
 * /competitors — the fleet-wide competitor index (#356). Grouped by rival, but
 * watching stays per (app, rival) pair.
 */
import { PortfolioCompetitorsView } from "../features/portfolioCompetitors/PortfolioCompetitorsView.js";
import { client } from "../api.js";

export function PortfolioCompetitorsRoute() {
  return <PortfolioCompetitorsView client={client} />;
}
