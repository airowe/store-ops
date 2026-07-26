/**
 * SCAFFOLD STUB (#356) — /competitors, the fleet-wide competitor index.
 *
 * Replace this with the real view built against `/tmp/dc/Competitors.dc.html`.
 * Grouped by rival; watching is a per-(app, rival) fact, so each rival card
 * lists its pairs with their own state. There is no `sharedTerms` count.
 */
import type { ApiClient } from "@shipaso/api";

export function PortfolioCompetitorsView(_props: { client: ApiClient }) {
  return <div data-testid="portfolio-competitors" />;
}
