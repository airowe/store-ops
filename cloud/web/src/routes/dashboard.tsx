/**
 * "/dashboard" — the dashboard (PRD 04). Opening an app navigates to /apps/:id, which
 * this app now owns (edgeRoutes OWNED_PATHS), so it's a client-side router
 * navigation — instant, no full reload. (It was a hard navigation while the app
 * page still lived in the legacy dashboard.)
 */
import { useNavigate } from "@tanstack/react-router";
import { DashboardView } from "../features/dashboard/DashboardView.js";
import { client } from "../api.js";

export function DashboardRoute() {
  const navigate = useNavigate();
  return <DashboardView client={client} onOpen={(id) => void navigate({ to: "/apps/$id", params: { id } })} />;
}
