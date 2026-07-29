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

/**
 * `?tab=connections` opens on the key cards. The run page's "Connect a key" CTA
 * links here, and the cards live behind a tab that defaults to monitoring — so
 * without this the link lands one hidden click short of the thing it promised.
 *
 * Read off `location.search` rather than a typed route search schema: no route
 * in this app declares `validateSearch` yet, and one optional deep-link hint is
 * not worth being the first.
 */
function initialTabFromUrl(): "monitor" | "connections" {
  if (typeof window === "undefined") return "monitor";
  return new URLSearchParams(window.location.search).get("tab") === "connections"
    ? "connections"
    : "monitor";
}

export function AppDetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return (
    <AppDetailView
      client={client}
      id={id}
      initialTab={initialTabFromUrl()}
      onOpenRun={(runId) => void navigate({ to: "/runs/$id", params: { id: runId } })}
      onWarRoom={(appId) => void navigate({ to: "/apps/$id/war-room", params: { id: appId } })}
    />
  );
}
