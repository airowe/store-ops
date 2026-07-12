/**
 * /apps/:id (PRD 05). Run detail (/runs/:id, PRD 07) and War room
 * (/apps/:id/war-room, PRD 06) are now BOTH owned by this app (see edgeRoutes
 * OWNED_PATHS), so opening them is a client-side router navigation — instant, no
 * full reload. (They were hard navigations while those routes still lived in the
 * legacy dashboard.)
 */
import { useNavigate, useParams } from "@tanstack/react-router";
import { AppDetailView } from "../features/appDetail/AppDetailView.js";
import { client } from "../api.js";

export function AppDetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return (
    <AppDetailView
      client={client}
      id={id}
      onOpenRun={(runId) => void navigate({ to: "/runs/$id", params: { id: runId } })}
      onWarRoom={(appId) => void navigate({ to: "/apps/$id/war-room", params: { id: appId } })}
    />
  );
}
