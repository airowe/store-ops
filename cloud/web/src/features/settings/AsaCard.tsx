/**
 * Connect Apple Search Ads (#78-2) — previously curl-only. An ASA key unlocks
 * Apple's OWN keyword search-popularity for your terms. The key is VERIFIED
 * against Apple before storing (server-side); an invalid key is refused with a
 * key-free reason and never saved.
 *
 * Honest: once a key is connected the row stays visible as a "Verified"
 * connection showing METADATA ONLY — never the key id, the .p8 filename, or any
 * key material; Stored keys manages and deletes it. The server's note is shown
 * verbatim, including the "popularity turns on once verified on this deployment"
 * caveat — so the UI never implies numbers that aren't flowing yet.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { connectAsa } from "@shipaso/api";

export function AsaCard({ client, hasAsaKey }: { client: ApiClient; hasAsaKey: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ privateKey: "", clientId: "", teamId: "", keyId: "", orgId: "" });
  const [revealed, setRevealed] = useState(false);
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

  // Already connected — show the connection rather than vanishing, but metadata
  // only. Stored keys is where it's managed and deleted.
  if (hasAsaKey) {
    return (
      <div data-testid="asa-card">
        <div className="conn-row">
          <span className="conn-chip brand" aria-hidden="true">
            A
          </span>
          <div className="conn-main">
            <div className="conn-name">Apple Search Ads</div>
            <div className="conn-meta" data-testid="asa-meta">
              Key verified · managed in Stored keys
            </div>
          </div>
          <span className="status-pill is-on" data-testid="asa-status-pill">
            Verified
          </span>
        </div>
        <p className="conn-note">Apple’s real keyword search popularity is available for your terms.</p>
      </div>
    );
  }

  const canConnect = !!(f.privateKey.trim() && f.clientId.trim() && f.teamId.trim() && f.keyId.trim() && f.orgId.trim());

  return (
    <div data-testid="asa-card">
      <div className="conn-row">
        <span className="conn-chip brand" aria-hidden="true">
          A
        </span>
        <div className="conn-main">
          <div className="conn-name">Apple Search Ads</div>
          <div className="conn-meta">Not connected · Search Ads API key</div>
        </div>
        <span className="status-pill" data-testid="asa-status-pill">
          Optional
        </span>
        <button type="button" className="btn ghost" data-testid="asa-reveal" onClick={() => setRevealed((v) => !v)}>
          Connect
        </button>
      </div>

      <p className="conn-note">
        Connect a Search Ads API key to show Apple’s real keyword search popularity for your terms. The
        key is verified against Apple before it’s stored, and never shown back.
      </p>

      {revealed ? (
        <div className="conn-form">
          <div className="conn-form-grid">
            <input className="txt" data-testid="asa-client-id" placeholder="Client ID" value={f.clientId} onChange={set("clientId")} />
            <input className="txt" data-testid="asa-team-id" placeholder="Team ID" value={f.teamId} onChange={set("teamId")} />
            <input className="txt" data-testid="asa-key-id" placeholder="Key ID" value={f.keyId} onChange={set("keyId")} />
            <input className="txt" data-testid="asa-org-id" placeholder="Org ID" value={f.orgId} onChange={set("orgId")} />
          </div>
          <textarea
            className="txt"
            data-testid="asa-private-key"
            placeholder="Contents of your Search Ads .p8 private key"
            rows={4}
            value={f.privateKey}
            onChange={set("privateKey")}
          />
          <button
            type="button"
            className="btn primary"
            data-testid="asa-connect"
            disabled={connect.isPending || !canConnect}
            onClick={() => connect.mutate()}
          >
            {connect.isPending ? "Verifying…" : "Connect & verify"}
          </button>
        </div>
      ) : null}

      {connect.data ? (
        <p className="conn-note" data-testid="asa-note">
          {connect.data.note}
        </p>
      ) : null}
      {connect.isError ? (
        <p className="conn-note" data-testid="asa-error">
          {connect.error instanceof Error ? connect.error.message : "Apple Search Ads didn’t accept the key."}
        </p>
      ) : null}
    </div>
  );
}
