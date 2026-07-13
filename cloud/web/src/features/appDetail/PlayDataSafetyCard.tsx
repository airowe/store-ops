/**
 * Push the owner's Google Play "Data safety" declaration (PRD 02-B) — the first
 * Play fix-and-push. Because data safety is a LEGAL declaration, the UI is
 * deliberately conservative: the CSV is the OWNER's own (paste the file you export
 * from Play Console → App content → Data safety), we never generate it, and the
 * push is fenced behind an explicit "I confirm this is my declaration" checkbox.
 *
 * The audit card already surfaces the read-side lint ("declares collection but no
 * linked privacy policy"); this card is the write that closes that loop.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getCredentials, pushPlayDataSafety } from "@shipaso/api";

export function PlayDataSafetyCard({ client, appId }: { client: ApiClient; appId: string }) {
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const [packageName, setPackageName] = useState("");
  const [safetyLabels, setSafetyLabels] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const storedPlayKey = (credsQ.data?.credentials ?? []).find(
    (c) => c.kind === "play" && (c.appId === appId || c.appId === null),
  );

  const push = useMutation({
    mutationFn: () =>
      pushPlayDataSafety(client, appId, {
        packageName: packageName.trim(),
        safetyLabels,
        ...(storedPlayKey ? { useStored: true } : { serviceAccount }),
      }),
  });

  if (credsQ.isLoading) return null;
  const canPush =
    !!packageName.trim() &&
    safetyLabels.trim() !== "" &&
    confirmed &&
    (!!storedPlayKey || !!serviceAccount.trim());

  return (
    <div className="card" data-testid="play-data-safety-card">
      <b>Google Play data safety — push declaration</b>
      <p className="micro">
        Pushes your Play <b>data-safety declaration</b> via the official API. Paste the CSV you export from
        Play Console → App content → Data safety — it's pushed <b>verbatim</b>, never rewritten. This replaces
        your whole declaration, so confirm it's correct.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          data-testid="pds-package"
          placeholder="Play package id (com.foo.bar)"
          value={packageName}
          onChange={(e) => setPackageName(e.target.value)}
        />
        <textarea
          data-testid="pds-csv"
          placeholder="Paste your data-safety CSV (header row + data rows)"
          rows={6}
          value={safetyLabels}
          onChange={(e) => setSafetyLabels(e.target.value)}
        />
        {!storedPlayKey ? (
          <textarea
            data-testid="pds-sa"
            placeholder="Service account JSON"
            rows={4}
            value={serviceAccount}
            onChange={(e) => setServiceAccount(e.target.value)}
          />
        ) : null}
        <label className="micro" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            data-testid="pds-confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm this is my own declaration and it is accurate. It will replace my live Play data-safety form.</span>
        </label>
        <button
          className="btn primary"
          data-testid="pds-push"
          disabled={push.isPending || !canPush}
          onClick={() => push.mutate()}
        >
          {push.isPending ? "Pushing…" : "Push declaration"}
        </button>
      </div>

      {push.isError ? (
        <p className="micro" data-testid="pds-error">
          {push.error instanceof Error ? push.error.message : "The data-safety push failed."}
        </p>
      ) : null}
      {push.isSuccess ? (
        <p className="micro" data-testid="pds-success">
          Pushed your data-safety declaration.
        </p>
      ) : null}
    </div>
  );
}
