/**
 * PlayFunnelCard (analytics-reports) — the measured Google Play conversion
 * funnel from the owner's monthly GCS export.
 *
 * Honesty, load-bearing:
 *   • measured months render real counts; a null count reads "—", never a
 *     fabricated 0;
 *   • no export yet → an honest empty-state, never a zero series;
 *   • the ingest service-account is used ONCE and never persisted on this device
 *     (held in local state, sent straight through — no SecureStore/file write).
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { getPlayFunnel, ingestPlayFunnel } from "../api/endpoints.js";
import type { PlayFunnelSurface } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

const pct = (rate: number | null): string => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);
const num = (n: number | null): string => (n === null ? "—" : n.toLocaleString());

export function PlayFunnelCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [surface, setSurface] = useState<PlayFunnelSurface | null>(null);
  const [packageName, setPackageName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSurface(await getPlayFunnel(client, appId));
    } catch {
      setSurface({ state: "empty", cadence: "monthly", throughPeriod: null, months: [] });
    }
  }, [client, appId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canIngest =
    packageName.trim() !== "" && accountId.trim() !== "" && serviceAccount.trim() !== "";

  async function ingest() {
    if (!canIngest) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await ingestPlayFunnel(client, appId, {
        packageName: packageName.trim(),
        accountId: accountId.trim(),
        serviceAccount: serviceAccount.trim(),
      });
      setSuccess(
        `Pulled ${r.ingested} row${r.ingested === 1 ? "" : "s"}${r.periods.length ? ` for ${r.periods.join(", ")}` : ""}.`,
      );
      setServiceAccount(""); // drop the credential from state after use
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t ingest the funnel.");
    } finally {
      setBusy(false);
    }
  }

  if (!surface) return null;
  const measured = surface.state === "measured";

  return (
    <Card>
      <AppText kind="lead">Google Play funnel</AppText>

      {measured ? (
        <View testID="pf-table" style={{ marginTop: spacing.xs }}>
          <AppText kind="micro" testID="pf-stamp">
            Monthly · through {surface.throughPeriod}. Store-listing visitors → acquisitions.
          </AppText>
          {surface.months.map((m) => (
            <View
              key={`${m.period}-${m.country || "all"}`}
              testID={`pf-row-${m.period}-${m.country || "all"}`}
              style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs }}
            >
              <AppText kind="mono" style={{ flex: 1 }}>
                {m.period} · {m.country ? m.country.toUpperCase() : "All"}
              </AppText>
              <AppText kind="micro">
                {num(m.visitors)} → {num(m.acquisitions)} · {pct(m.conversionRate)}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText kind="dim" testID="pf-empty" style={{ marginTop: spacing.xs }}>
          No Play funnel yet — ingest your monthly BigQuery/GCS export to see measured
          store-listing conversion. Nothing is shown until it’s measured.
        </AppText>
      )}

      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <AppText kind="micro">
          Ingest from your Play Console GCS export. The service account is used once and never
          stored on this device.
        </AppText>
        <TextField testID="pf-package" value={packageName} onChangeText={setPackageName} placeholder="Package name (com.acme.app)" />
        <TextField testID="pf-account" value={accountId} onChangeText={setAccountId} placeholder="Play developer account ID" />
        <TextField
          testID="pf-sa"
          value={serviceAccount}
          onChangeText={setServiceAccount}
          placeholder="Service-account JSON"
          multiline
        />
        <Button
          testID="pf-ingest"
          label="Ingest funnel"
          variant="ghost"
          disabled={!canIngest}
          loading={busy}
          onPress={() => void ingest()}
        />
      </View>

      {error ? (
        <AppText kind="micro" testID="pf-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
      {success ? (
        <AppText kind="micro" testID="pf-success" style={{ color: palette.signal }}>
          {success}
        </AppText>
      ) : null}
    </Card>
  );
}
