/**
 * /apps/:id (PRD 05). Run rows open /runs/:id and War room opens
 * /apps/:id/war-room — both still legacy (PRD 07 / PRD 06), so they're real
 * navigations the edge routes, not in-SPA pushes to routes that don't exist yet.
 */
import { useParams } from "@tanstack/react-router";
import { AppDetailView } from "../features/appDetail/AppDetailView.js";
import { client } from "../api.js";

export function AppDetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <AppDetailView
      client={client}
      id={id}
      onOpenRun={(runId) => window.location.assign(`/runs/${runId}`)}
      onWarRoom={(appId) => window.location.assign(`/apps/${appId}/war-room`)}
    />
  );
}
