/**
 * PlayDataSafetyCard (Play) — push the owner's Data safety declaration to Google
 * Play. The CSV is the owner's own declaration, pushed verbatim; nothing is
 * inferred or invented on their behalf.
 *
 * Security, load-bearing: the push CHANGES a live Play listing, so it requires
 * an explicit confirmation; the service account is used ONCE and never persisted
 * on this device (local state, sent straight through — no SecureStore/file).
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { pushPlayDataSafety } from "../api/endpoints.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

export function PlayDataSafetyCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [packageName, setPackageName] = useState("");
  const [safetyLabels, setSafetyLabels] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canPush =
    packageName.trim() !== "" &&
    safetyLabels.trim() !== "" &&
    serviceAccount.trim() !== "" &&
    confirmed;

  async function push() {
    if (!canPush) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await pushPlayDataSafety(client, appId, {
        packageName: packageName.trim(),
        safetyLabels: safetyLabels.trim(),
        serviceAccount: serviceAccount.trim(),
      });
      setSuccess(true);
      setServiceAccount(""); // drop the credential from state after use
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t push the declaration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText kind="lead">Play data safety</AppText>
      <AppText kind="micro">
        Push your Data safety declaration to Google Play. This changes your live listing — your CSV
        is sent verbatim, and the service account is used once and never stored on this device.
      </AppText>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <TextField testID="pds-package" value={packageName} onChangeText={setPackageName} placeholder="Package name (com.acme.app)" />
        <TextField
          testID="pds-csv"
          value={safetyLabels}
          onChangeText={setSafetyLabels}
          placeholder="Data-safety CSV (your declaration)"
          multiline
        />
        <TextField testID="pds-sa" value={serviceAccount} onChangeText={setServiceAccount} placeholder="Service-account JSON" multiline />
        <Button
          testID="pds-confirm"
          label={confirmed ? "✓ I understand this changes my live listing" : "Confirm: this changes my live listing"}
          variant={confirmed ? "primary" : "ghost"}
          onPress={() => setConfirmed((v) => !v)}
        />
        <Button
          testID="pds-push"
          label="Push data-safety declaration"
          disabled={!canPush}
          loading={busy}
          onPress={() => void push()}
        />
      </View>

      {error ? (
        <AppText kind="micro" testID="pds-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
      {success ? (
        <AppText kind="micro" testID="pds-success" style={{ color: palette.signal }}>
          Pushed your data-safety declaration.
        </AppText>
      ) : null}
    </Card>
  );
}
