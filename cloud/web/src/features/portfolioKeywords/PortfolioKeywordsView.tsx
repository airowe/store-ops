/**
 * SCAFFOLD STUB (#356) — /keywords, the fleet-wide keyword index.
 *
 * Replace this with the real view built against `/tmp/dc/Keywords.dc.html`.
 * A row is a keyword × app × storefront pair. Unmeasured ranks render "—",
 * never 0, and live in their own explicit section.
 */
import type { ApiClient } from "@shipaso/api";

export function PortfolioKeywordsView(_props: { client: ApiClient }) {
  return <div data-testid="portfolio-keywords" />;
}
