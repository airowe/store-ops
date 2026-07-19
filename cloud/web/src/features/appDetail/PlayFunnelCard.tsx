/**
 * Google Play conversion funnel (PRD 02-D) — the Play sibling of the iOS
 * ConversionCard. Reads the measured MONTHLY series (store-listing visitors →
 * acquisitions → derived conversion rate) from our own D1, and offers a gated
 * ingest that pulls the latest months from the developer's GCS export bucket.
 *
 * Honesty framing (load-bearing): every number is stamped "monthly · through
 * <period>", never implied to be live; conversion rate is DERIVED and shows "—"
 * when it can't be honestly computed (never a fabricated 0).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getCredentials, getPlayFunnel, ingestPlayFunnel } from "@shipaso/api";

function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}
function num(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

export function PlayFunnelCard({ client, appId }: { client: ApiClient; appId: string }) {
  const qc = useQueryClient();
  const funnelQ = useQuery({ queryKey: ["play-funnel", appId], queryFn: () => getPlayFunnel(client, appId) });
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });

  const [packageName, setPackageName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");

  const storedPlayKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "play" && (c.appId === appId || c.appId === null),
  );

  const ingest = useMutation({
    mutationFn: () =>
      ingestPlayFunnel(client, appId, {
        packageName: packageName.trim(),
        accountId: accountId.trim(),
        ...(storedPlayKey ? { useStored: true } : { serviceAccount }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["play-funnel", appId] }),
  });

  const surface = funnelQ.data;
  const measured = surface?.state === "measured";
  const canIngest =
    !!packageName.trim() && !!accountId.trim() && (!!storedPlayKey || !!serviceAccount.trim());

  return (
    <div className="card" data-testid="play-funnel-card">
      <b>Google Play conversion funnel</b>
      {measured ? (
        <>
          <p className="micro" data-testid="pf-stamp">
            Monthly · through {surface!.throughPeriod}. Store-listing visitors → acquisitions, from your Play
            export. Lagged, not live.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="micro" data-testid="pf-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Month</th>
                  <th>Market</th>
                  <th>Visitors</th>
                  <th>Acquisitions</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {surface!.months.map((m) => (
                  <tr key={`${m.period}-${m.country}`} data-testid={`pf-row-${m.period}-${m.country || "all"}`}>
                    <td>{m.period}</td>
                    <td>{m.country ? m.country.toUpperCase() : "All"}</td>
                    <td>{num(m.visitors)}</td>
                    <td>{num(m.acquisitions)}</td>
                    <td>{pct(m.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="micro" data-testid="pf-empty">
          No Play funnel ingested yet. Pull your monthly export below — it's monthly and lagged, the only
          official Play conversion source.
        </p>
      )}

      {credsQ.isLoading ? null : (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <input
            data-testid="pf-package"
            placeholder="Play package id (com.foo.bar)"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
          />
          <input
            data-testid="pf-account"
            placeholder="Play developer account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
          {!storedPlayKey ? (
            <textarea
              data-testid="pf-sa"
              placeholder="Service account JSON"
              rows={3}
              value={serviceAccount}
              onChange={(e) => setServiceAccount(e.target.value)}
            />
          ) : null}
          <button
            className="btn"
            data-testid="pf-ingest"
            disabled={ingest.isPending || !canIngest}
            onClick={() => ingest.mutate()}
          >
            {ingest.isPending ? "Pulling…" : "Pull monthly funnel"}
          </button>
          {ingest.isError ? (
            <p className="micro" data-testid="pf-error">
              {ingest.error instanceof Error ? ingest.error.message : "The funnel ingest failed."}
            </p>
          ) : null}
          {ingest.isSuccess ? (
            <p className="micro" data-testid="pf-success">
              Pulled {ingest.data.ingested} row(s){ingest.data.periods.length ? ` for ${ingest.data.periods.join(", ")}` : ""}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
