/**
 * Connect Apple Search Ads (#78-2) — previously curl-only. An ASA key unlocks
 * Apple's OWN keyword search-popularity for your terms. The key is VERIFIED
 * against Apple before storing (server-side); an invalid key is refused with a
 * key-free reason and never saved.
 *
 * Honest: the card hides once a key is connected (the "Stored keys" section
 * manages + deletes it); the server's note is shown verbatim, including the
 * "popularity turns on once verified on this deployment" caveat — so the UI never
 * implies numbers that aren't flowing yet.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { connectAsa } from "@shipaso/api";

export function AsaCard({ client, hasAsaKey }: { client: ApiClient; hasAsaKey: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ privateKey: "", clientId: "", teamId: "", keyId: "", orgId: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const connect = useMutation({
    mutationFn: () =>
      connectAsa(client, {
        privateKey: f.privateKey,
        clientId: f.clientId.trim(),
        teamId: f.teamId.trim(),
        keyId: f.keyId.trim(),
        orgId: f.orgId.trim(),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["account", "credentials"] }),
  });

  // Already connected — the Stored-keys section shows + deletes it.
  if (hasAsaKey) return null;

  const canConnect = !!(f.privateKey.trim() && f.clientId.trim() && f.teamId.trim() && f.keyId.trim() && f.orgId.trim());

  return (
    <div className="card" data-testid="asa-card">
      <b>Apple Search Ads</b>
      <p className="micro">
        Connect a Search Ads API key to show Apple’s real keyword search popularity for your terms.
        The key is verified against Apple before it’s stored, and never shown back.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <input data-testid="asa-client-id" placeholder="Client ID" value={f.clientId} onChange={set("clientId")} />
        <input data-testid="asa-team-id" placeholder="Team ID" value={f.teamId} onChange={set("teamId")} />
        <input data-testid="asa-key-id" placeholder="Key ID" value={f.keyId} onChange={set("keyId")} />
        <input data-testid="asa-org-id" placeholder="Org ID" value={f.orgId} onChange={set("orgId")} />
        <textarea data-testid="asa-private-key" placeholder="Contents of your Search Ads .p8 private key" rows={4} value={f.privateKey} onChange={set("privateKey")} />
        <button type="button"
          className="btn primary"
          data-testid="asa-connect"
          disabled={connect.isPending || !canConnect}
          onClick={() => connect.mutate()}
        >
          {connect.isPending ? "Verifying…" : "Connect & verify"}
        </button>
      </div>
      {connect.data ? <p className="micro" data-testid="asa-note">{connect.data.note}</p> : null}
      {connect.isError ? (
        <p className="micro" data-testid="asa-error">
          {connect.error instanceof Error ? connect.error.message : "Apple Search Ads didn’t accept the key."}
        </p>
      ) : null}
    </div>
  );
}
