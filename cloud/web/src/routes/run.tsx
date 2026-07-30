/**
 * /runs/:id (PRD 07) — the money screen. Migrated LAST, once the pattern was
 * proven on 03–06.
 *
 * Two destinations, deliberately separate. "Connect a key" is APP-scoped and
 * goes to /apps/$id, where <ConnectAscCard /> lives — it reads the stored key
 * for that app and offers "Run keyed audit" when one exists. The MCP/agent
 * handoff is ACCOUNT-scoped and goes to /settings.
 *
 * Both used to share one callback pointed at /settings, which sent someone who
 * already had a key stored to a page with no app context and no key form.
 */
import { useNavigate, useParams } from "@tanstack/react-router";
import { RunView } from "../features/run/RunView.js";
import { client } from "../api.js";

export function RunRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return (
    <RunView
      client={client}
      id={id}
      onConnect={(appId) =>
        void navigate({
          to: "/apps/$id",
          params: { id: appId },
          // The key cards sit behind the Connections tab; without this the CTA
          // lands on monitoring and the user has to go find them.
          search: { tab: "connections" },
        })
      }
      onAccountSettings={() => void navigate({ to: "/settings" })}
    />
  );
}
