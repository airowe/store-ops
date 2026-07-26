/**
 * /runs — the fleet-wide run index (#356). Wraps the injectable view with the
 * singleton client; the view owns every state (loading / empty / populated).
 */
import { PortfolioRunsView } from "../features/portfolioRuns/PortfolioRunsView.js";
import { client } from "../api.js";

export function PortfolioRunsRoute() {
  return <PortfolioRunsView client={client} />;
}
