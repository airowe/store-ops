/**
 * AnalyticsCard (analytics-reports Phase 3) — the setup affordance that turns on
 * Apple's measured Analytics Engagement report. Paste an ASC key, enable the
 * ongoing request, then ingest once Apple has it ready. The measured number
 * itself renders in ConversionCard; this card yields to it once data exists.
 *
 * Security, load-bearing: the .p8 trio lives ONLY in this component's local
 * state, is sent once to enable/ingest, and is never written to device storage
 * (no SecureStore, no file). Honest states: every non-ingested result carries a
 * verbatim message — never a fabricated success.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { enableAnalytics, ingestAnalytics } from "../api/endpoints.js";
import type { AnalyticsState, AnalyticsIngestResult } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

function ingestLine(r: AnalyticsIngestResult): string {
  if (r.state === "ingested") {
    return `Ingested ${r.rowsPersisted} rows across ${r.days} day${r.days === 1 ? "" : "s"}.`;
  }
  return r.message; // every non-ingested variant carries an honest message
}

export function AnalyticsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [p8, setP8] = useState("");
  const [enableState, setEnableState] = useState<AnalyticsState | null>(null);
  const [ingestResult, setIngestResult] = useState<AnalyticsIngestResult | null>(null);
  const [busy, setBusy] = useState<"enable" | "ingest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAct = keyId.trim() !== "" && issuerId.trim() !== "" && p8.trim() !== "";
  const body = () => ({ p8: p8.trim(), keyId: keyId.trim(), issuerId: issuerId.trim() });
  const pending = enableState?.state === "pending";

  async function enable() {
    if (!canAct) return;
    setBusy("enable");
    setError(null);
    try {
      setEnableState(await enableAnalytics(client, appId, body()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t enable analytics.");
    } finally {
      setBusy(null);
    }
  }

  async function ingest() {
    setBusy("ingest");
    setError(null);
    try {
      setIngestResult(await ingestAnalytics(client, appId, body()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t ingest the report.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <AppText kind="lead" testID="analytics-connect">Measure real conversion</AppText>
      <AppText kind="micro">
        Turn on Apple’s Analytics Engagement report to see measured downloads ÷ product-page views.
        Your key is used once to enable + pull it, and never stored on this device.
      </AppText>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <TextField testID="an-key-id" value={keyId} onChangeText={setKeyId} placeholder="Key ID" />
        <TextField testID="an-issuer-id" value={issuerId} onChangeText={setIssuerId} placeholder="Issuer ID" />
        <TextField testID="an-p8" value={p8} onChangeText={setP8} placeholder="Contents of your .p8 key file" multiline />
        <Button
          testID="an-enable"
          label="Enable analytics"
          disabled={!canAct}
          loading={busy === "enable"}
          onPress={() => void enable()}
        />
        {pending ? (
          <Button
            testID="an-ingest"
            label="Ingest now"
            variant="ghost"
            loading={busy === "ingest"}
            onPress={() => void ingest()}
          />
        ) : null}
      </View>

      {enableState ? (
        <AppText kind="micro" testID="an-state" style={{ marginTop: spacing.sm }}>
          {enableState.message}
        </AppText>
      ) : null}
      {error ? (
        <AppText kind="micro" testID="an-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
      {ingestResult ? (
        <AppText kind="micro" testID="an-ingest-result" style={{ color: palette.signal }}>
          {ingestLine(ingestResult)}
        </AppText>
      ) : null}
    </Card>
  );
}
