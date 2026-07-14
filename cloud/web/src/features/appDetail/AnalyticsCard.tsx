/**
 * Connect analytics (analytics-reports Phase 1/2 UI) — the setup affordance for
 * MEASURED conversion. Enabling creates an ongoing Engagement report request in
 * the user's App Store Connect account, so it needs an ADMIN-role key and an
 * explicit click (the same consent posture as the server route).
 *
 * Honest throughout: every state the server returns (needs Admin, requested /
 * ~1–2 day wait, ingested counts) is shown verbatim — never a fabricated number.
 * A saved key (#67) enables in one click; otherwise paste an Admin key (used once
 * to mint a short-lived token, never logged or shown back). The measured number
 * itself renders in <ConversionCard/> once ingested — this card is just setup.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AnalyticsIngestResult, ApiClient, AscCredentialBody } from "@shipaso/api";
import { enableAnalytics, getCredentials, ingestAnalytics } from "@shipaso/api";

export function AnalyticsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [p8, setP8] = useState("");

  const enable = useMutation({ mutationFn: (body: AscCredentialBody) => enableAnalytics(client, appId, body) });
  const ingest = useMutation({ mutationFn: (body: AscCredentialBody) => ingestAnalytics(client, appId, body) });

  const storedKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "asc" && (c.appId === appId || c.appId === null),
  );
  // The creds we act with: the saved key (one click) or the pasted Admin key.
  const body: AscCredentialBody = storedKey
    ? { useStored: true }
    : { p8, keyId: keyId.trim(), issuerId: issuerId.trim() };
  const canAct = storedKey ? true : !!(p8.trim() && keyId.trim() && issuerId.trim());

  // Once a request exists (enable → pending), ingest becomes available.
  const pending = enable.data?.state === "pending";

  if (credsQ.isLoading) return null;

  return (
    <div className="card" data-testid="analytics-connect">
      <b>Measured conversion</b>
      <p className="micro">
        See real conversion (downloads ÷ product-page views) from Apple’s Analytics
        Reports. Enabling creates an ongoing report request in your App Store Connect
        account — it needs an <b>Admin</b>-role key, and Apple takes ~1–2 days to
        generate the first report.
      </p>

      {!storedKey ? (
        <div style={{ display: "grid", gap: 8 }}>
          <input data-testid="an-key-id" placeholder="Key ID (Admin)" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
          <input data-testid="an-issuer-id" placeholder="Issuer ID" value={issuerId} onChange={(e) => setIssuerId(e.target.value)} />
          <textarea data-testid="an-p8" placeholder="Contents of your Admin .p8 key file" rows={4} value={p8} onChange={(e) => setP8(e.target.value)} />
        </div>
      ) : (
        <p className="micro">Using your saved key ({storedKey.keyId}).</p>
      )}

      <div className="btn-row" style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button type="button"
          className="btn primary"
          data-testid="an-enable"
          disabled={enable.isPending || !canAct}
          onClick={() => enable.mutate(body)}
        >
          {enable.isPending ? "Requesting…" : "Enable analytics"}
        </button>
        {pending ? (
          <button type="button"
            className="btn ghost"
            data-testid="an-ingest"
            disabled={ingest.isPending}
            onClick={() => ingest.mutate(body)}
          >
            {ingest.isPending ? "Checking…" : "Ingest now"}
          </button>
        ) : null}
      </div>

      {enable.data ? (
        <p className="micro" data-testid="an-state">
          {enable.data.message}
        </p>
      ) : null}
      {enable.isError ? (
        <p className="micro" data-testid="an-error">
          {enable.error instanceof Error ? enable.error.message : "Couldn’t enable analytics."}
        </p>
      ) : null}
      {ingest.data ? <p className="micro" data-testid="an-ingest-result">{ingestLine(ingest.data)}</p> : null}
    </div>
  );
}

/** Honest one-liner for an ingest result — counts on success, the state otherwise. */
function ingestLine(r: AnalyticsIngestResult): string {
  if (r.state === "ingested") {
    return `Ingested ${r.rowsPersisted} rows across ${r.days} day${r.days === 1 ? "" : "s"}.`;
  }
  return r.message; // every non-ingested variant carries an honest message
}
