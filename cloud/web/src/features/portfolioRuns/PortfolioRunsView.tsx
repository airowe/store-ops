/**
 * SCAFFOLD STUB (#356) — /runs, the fleet-wide run index.
 *
 * Replace this with the real view built against `/tmp/dc/Runs.dc.html`.
 * The action queue (runs awaiting approval) leads at any age; the server
 * already orders the response, so partition by status rather than re-sorting.
 */
import type { ApiClient } from "@shipaso/api";

export function PortfolioRunsView(_props: { client: ApiClient }) {
  return <div data-testid="portfolio-runs" />;
}
