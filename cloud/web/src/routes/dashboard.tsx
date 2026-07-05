/**
 * "/" — the dashboard (PRD 04). Opening an app navigates to /apps/:id, which is
 * still served by the legacy dashboard until PRD 05 — so it's a real navigation
 * the edge routes, not an in-SPA push to a route that doesn't exist yet.
 */
import { DashboardView } from "../features/dashboard/DashboardView.js";
import { client } from "../api.js";

export function DashboardRoute() {
  return <DashboardView client={client} onOpen={(id) => window.location.assign(`/apps/${id}`)} />;
}
