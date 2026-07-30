/**
 * Agent access — scoped "shipaso_…" API keys (#93). A key lets an external AI
 * agent connect to the ShipASO MCP (/mcp) and run the audit → propose loop.
 *
 * Honest, load-bearing:
 *   • the raw key is shown ONCE, right after you generate it — we store only its
 *     hash, so we can never show it again (copy it then). That moment gets an
 *     amber surface: urgent and unrepeatable, but not an error,
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
    <section id="agent" className="settings-panel" data-testid="api-keys-card">
      <div className="settings-panel-head">
        <h2>Agent access</h2>
      </div>
      <p className="settings-panel-sub">
        Scoped keys so your own AI agent can run the audit → propose loop over MCP. Read and draft only
        — an agent can never push. Approving and shipping stay here.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          className="txt"
          data-testid="ak-label"
          placeholder="Label (e.g. Claude Code)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" className="btn primary" data-testid="ak-create" disabled={busy} onClick={() => create.mutate()}>
          {create.isPending ? "Generating…" : "Generate key"}
        </button>
      </div>

      {freshKey ? (
        <div className="shown-once" data-testid="ak-fresh">
          <div className="shown-once-eyebrow" data-testid="ak-fresh-eyebrow">
            SHOWN ONCE
          </div>
          <p className="shown-once-note">Copy it now — we store only its hash.</p>
          <pre className="shown-once-key" data-testid="ak-fresh-value">
            {freshKey}
          </pre>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <div data-testid="ak-list" style={{ marginTop: 8 }}>
          {keys.map((k) => (
            <div key={k.id} className="pref-row" data-testid={`ak-${k.id}`}>
              <div className="pref-row-main">
                <div className="pref-row-title mono">
                  {k.prefix}
                  {k.label ? ` · ${k.label}` : ""}
                </div>
                {k.createdAt ? <div className="pref-row-detail">added {k.createdAt.slice(0, 10)}</div> : null}
              </div>
              <button
                type="button"
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
    </section>
  );
}
