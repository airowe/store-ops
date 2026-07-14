/**
 * Google Play audit (the Android loop) — previously curl-only. Runs a READ-ONLY
 * audit of your Play listing via the Developer API using a service account
 * (pasted here, used in-request and never stored, or a saved key). The audit
 * never publishes — the Developer API path opens and discards an edit.
 *
 * Honest: the findings / 🔒 locks are the SAME shapes the iOS run renders, so we
 * reuse FindingsCard. A lock is an unread surface, never a deficiency. The
 * service account is never shown back; Google's errors surface verbatim.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { auditPlay, getCredentials } from "@shipaso/api";
import { FindingsCard } from "../run/FindingsCard.js";

export function PlayAuditCard({ client, appId }: { client: ApiClient; appId: string }) {
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const [packageName, setPackageName] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");

  const storedPlayKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "play" && (c.appId === appId || c.appId === null),
  );
  const audit = useMutation({
    mutationFn: () =>
      auditPlay(client, appId, {
        packageName: packageName.trim(),
        ...(storedPlayKey ? { useStored: true } : { serviceAccount }),
      }),
  });

  if (credsQ.isLoading) return null;
  const canRun = !!packageName.trim() && (!!storedPlayKey || !!serviceAccount.trim());

  return (
    <div className="card" data-testid="play-audit-card">
      <b>Google Play audit</b>
      <p className="micro">
        Read-only audit of your Play listing. {storedPlayKey ? "Uses your saved service account." : "Paste a service account — used once, never stored."} It never publishes.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <input data-testid="play-package" placeholder="Play package id (com.foo.bar)" value={packageName} onChange={(e) => setPackageName(e.target.value)} />
        {!storedPlayKey ? (
          <textarea data-testid="play-sa" placeholder="Service account JSON" rows={4} value={serviceAccount} onChange={(e) => setServiceAccount(e.target.value)} />
        ) : null}
        <button type="button" className="btn primary" data-testid="play-run" disabled={audit.isPending || !canRun} onClick={() => audit.mutate()}>
          {audit.isPending ? "Auditing…" : "Run Play audit"}
        </button>
      </div>

      {audit.isError ? (
        <p className="micro" data-testid="play-error">
          {audit.error instanceof Error ? audit.error.message : "The Play audit failed."}
        </p>
      ) : null}

      {audit.data ? (
        <div data-testid="play-result" style={{ marginTop: 10 }}>
          {audit.data.screenshots?.grade ? (
            <p className="micro">Screenshots: grade {audit.data.screenshots.grade}.</p>
          ) : null}
          <FindingsCard
            findings={audit.data.findings}
            locks={audit.data.locks}
            {...(audit.data.summary !== undefined ? { summary: audit.data.summary } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
