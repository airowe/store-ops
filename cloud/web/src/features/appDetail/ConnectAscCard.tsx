/**
 * Connect App Store Connect (#179) — the UI end of the keyed (Mode-A) loop.
 * One saved key turns every later run and push into a single click; no CLI.
 *
 * Custody, honest and load-bearing:
 *   • the .p8 is sent once, used in-request to mint a short-lived token, and
 *     STORED ONLY if the user leaves "save" checked (envelope-encrypted, #67) —
 *     and only after it minted successfully. Never logged, never shown back.
 *   • with a saved key we show METADATA only (key id) and offer one-click
 *     keyed audits via `useStored` — the paste box never reappears.
 *   • a deployment without credential storage (no KEK) still supports the
 *     request-only keyed run; the save option simply isn't offered.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getCredentials, runAppWithAsc } from "@shipaso/api";

export function ConnectAscCard({
  client,
  appId,
  onRunStarted,
}: {
  client: ApiClient;
  appId: string;
  onRunStarted: (runId: string) => void;
}) {
  const qc = useQueryClient();
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [p8, setP8] = useState("");
  const [store, setStore] = useState(true);

  const run = useMutation({
    mutationFn: (body: Parameters<typeof runAppWithAsc>[2]) => runAppWithAsc(client, appId, body),
    onSuccess: (res) => {
      // A stored:true run saved a key — refresh the metadata list.
      void qc.invalidateQueries({ queryKey: ["credentials"] });
      onRunStarted(res.id);
    },
  });

  const enabled = credsQ.data?.enabled ?? false;
  const storedKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "asc" && (c.appId === appId || c.appId === null),
  );

  if (credsQ.isLoading) return null;

  return (
    <div className="card" data-testid="connect-asc">
      <b>App Store Connect</b>
      {storedKey ? (
        <>
          <p className="micro">
            Connected · key {storedKey.keyId}. Keyed audits read your real subtitle,
            keyword field, and screenshots — and unlock one-click push after approval.
          </p>
          <button type="button"
            className="btn primary"
            data-testid="asc-run-stored"
            disabled={run.isPending}
            onClick={() => run.mutate({ useStored: true })}
          >
            {run.isPending ? "Running…" : "Run keyed audit"}
          </button>
        </>
      ) : (
        <>
          <p className="micro">
            Connect an App Store Connect API key to audit your real listing (subtitle,
            keyword field, screenshots) and push approved copy from here. The key is
            used to mint a short-lived token and is never logged or shown back.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              data-testid="asc-key-id"
              placeholder="Key ID"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
            />
            <input
              data-testid="asc-issuer-id"
              placeholder="Issuer ID"
              value={issuerId}
              onChange={(e) => setIssuerId(e.target.value)}
            />
            <textarea
              data-testid="asc-p8"
              placeholder="Contents of your .p8 key file"
              rows={4}
              value={p8}
              onChange={(e) => setP8(e.target.value)}
            />
            {enabled ? (
              <label className="micro">
                <input
                  type="checkbox"
                  data-testid="asc-store"
                  checked={store}
                  onChange={(e) => setStore(e.target.checked)}
                />{" "}
                Save this key (encrypted) so future runs and pushes are one click
              </label>
            ) : null}
            <button type="button"
              className="btn primary"
              data-testid="asc-connect"
              disabled={run.isPending || !keyId.trim() || !issuerId.trim() || !p8.trim()}
              onClick={() =>
                run.mutate({
                  p8,
                  keyId: keyId.trim(),
                  issuerId: issuerId.trim(),
                  ...(enabled ? { store } : {}),
                })
              }
            >
              {run.isPending ? "Connecting…" : "Connect & run keyed audit"}
            </button>
          </div>
        </>
      )}
      {run.isError ? (
        <p className="micro" data-testid="asc-error">
          {run.error instanceof Error ? run.error.message : "The keyed run failed."}
        </p>
      ) : null}
    </div>
  );
}
