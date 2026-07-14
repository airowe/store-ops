/**
 * Agent access — scoped "shipaso_…" API keys (#93). A key lets an external AI
 * agent connect to the ShipASO MCP (/mcp) and run the audit → propose loop.
 *
 * Honest, load-bearing:
 *   • the raw key is shown ONCE, right after you generate it — we store only its
 *     hash, so we can never show it again (copy it then),
 *   • read/draft only: an agent can audit + propose but can NEVER push —
 *     approving and shipping stay a human action here,
 *   • revoke is immediate and independent of your login (it doesn't touch your
 *     session).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { createApiKey, listApiKeys, revokeApiKey } from "@shipaso/api";

export function ApiKeysCard({ client }: { client: ApiClient }) {
  const qc = useQueryClient();
  const keysQ = useQuery({ queryKey: ["api-keys"], queryFn: () => listApiKeys(client), retry: false });
  const [label, setLabel] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createApiKey(client, label.trim()),
    onSuccess: (k) => {
      setFreshKey(k.key);
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(client, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const keys = keysQ.data?.keys ?? [];
  const busy = create.isPending || revoke.isPending;

  return (
    <div className="card" data-testid="api-keys-card">
      <b>Agent access (API keys)</b>
      <p className="micro">
        Generate a scoped key so your AI agent can connect to the ShipASO MCP and run the
        audit → propose loop. Read-only + draft: an agent can never push — approving and
        shipping stay here. Revoke any time; it can’t touch your login.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          data-testid="ak-label"
          placeholder="Label (e.g. Claude Code)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" className="btn" data-testid="ak-create" disabled={busy} onClick={() => create.mutate()}>
          {create.isPending ? "Generating…" : "Generate key"}
        </button>
      </div>

      {freshKey ? (
        <div className="card" data-testid="ak-fresh" style={{ marginTop: 8 }}>
          <p className="micro">
            Copy your key now — we only show it once (we store just its hash):
          </p>
          <pre data-testid="ak-fresh-value" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {freshKey}
          </pre>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <div data-testid="ak-list" style={{ marginTop: 8 }}>
          {keys.map((k) => (
            <div key={k.id} className="setting-row" data-testid={`ak-${k.id}`}>
              <span style={{ flex: 1 }} className="mono">
                {k.prefix}
                {k.label ? ` · ${k.label}` : ""}
              </span>
              <button type="button"
                className="btn ghost"
                data-testid={`ak-revoke-${k.id}`}
                disabled={busy}
                onClick={() => revoke.mutate(k.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
