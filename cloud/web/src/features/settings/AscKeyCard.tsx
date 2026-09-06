/**
 * One App Store Connect key for the whole account (#560). An ASC API key is
 * team-scoped, so a person with a dozen apps should paste it once. The server
 * verifies it against Apple on a read before storing; a key that does not
 * work is never saved. Metadata only afterwards — Stored keys manages it.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { saveAscAccountKey } from "@shipaso/api";

export function AscKeyCard({ client, hasAccountKey }: { client: ApiClient; hasAccountKey: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ p8: "", keyId: "", issuerId: "" });
  const [revealed, setRevealed] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => saveAscAccountKey(client, { p8: f.p8, keyId: f.keyId.trim(), issuerId: f.issuerId.trim() }),
    onSuccess: () => {
      setF({ p8: "", keyId: "", issuerId: "" });
      void qc.invalidateQueries({ queryKey: ["account", "credentials"] });
    },
  });

  if (hasAccountKey) {
    return (
      <div data-testid="asc-key-card">
        <div className="conn-row">
          <span className="conn-chip brand" aria-hidden="true">

          </span>
          <div className="conn-main">
            <div className="conn-name">App Store Connect key</div>
            <div className="conn-meta" data-testid="asc-key-meta">
              Account-wide · verified · managed in Stored keys
            </div>
          </div>
          <span className="status-pill is-on" data-testid="asc-key-status-pill">
            Verified
          </span>
        </div>
        <p className="conn-note">Every app on this account can be pushed to with this key. An app with its own key keeps using that one.</p>
      </div>
    );
  }

  const canSave = !!(f.p8.trim() && f.keyId.trim() && f.issuerId.trim());

  return (
    <div data-testid="asc-key-card">
      <div className="conn-row">
        <span className="conn-chip brand" aria-hidden="true">

        </span>
        <div className="conn-main">
          <div className="conn-name">App Store Connect key</div>
          <div className="conn-meta">Not stored · API key for the whole team</div>
        </div>
        <span className="status-pill" data-testid="asc-key-status-pill">
          Needed for autopilot
        </span>
        <button type="button" className="btn ghost" data-testid="asc-key-reveal" onClick={() => setRevealed((v) => !v)}>
          Add key
        </button>
      </div>
      <p className="conn-note">
        Paste it once for every app. Verified against Apple before it’s stored, encrypted at rest, never shown back.
      </p>
      {revealed ? (
        <div className="conn-form">
          <div className="conn-form-grid">
            <input className="txt" data-testid="asc-key-id" placeholder="Key ID" value={f.keyId} onChange={set("keyId")} />
            <input className="txt" data-testid="asc-issuer-id" placeholder="Issuer ID" value={f.issuerId} onChange={set("issuerId")} />
          </div>
          <textarea className="txt" data-testid="asc-p8" placeholder="Contents of the .p8 private key" rows={4} value={f.p8} onChange={set("p8")} />
          <button type="button" className="btn primary" data-testid="asc-key-save" disabled={save.isPending || !canSave} onClick={() => save.mutate()}>
            {save.isPending ? "Verifying…" : "Verify & store"}
          </button>
        </div>
      ) : null}
      {save.isError ? (
        <p className="conn-note" data-testid="asc-key-error">
          {save.error instanceof Error ? save.error.message : "App Store Connect didn’t accept the key."}
        </p>
      ) : null}
    </div>
  );
}
