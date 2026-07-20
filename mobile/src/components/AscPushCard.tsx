/**
 * AscPushCard (#270) — push the approved copy to App Store Connect from the run
 * screen, using a STORED key. The last mile web already had; mobile's approval
 * gate previously stopped at copyable CLI commands.
 *
 * Safety, load-bearing:
 *   • present ONLY on an approved/shipped run with a stored key — there is no
 *     path here to push an unapproved run;
 *   • the push uses the stored key (useStored:true) — NO .p8 is sent from the
 *     device (the key lives server-side, envelope-encrypted);
 *   • an explicit tap, never automatic;
 *   • Apple's refusal is surfaced VERBATIM — never a fake "success";
 *   • a refused push (usually "no editable version") offers the #34 create-
 *     version recovery inline, then push again.
 */
import { useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { ascCreateVersion, ascPush } from "../api/endpoints.js";
import type { AscPushResult, AscCreateVersionResult } from "../types/api.js";
import { palette, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

export function AscPushCard({
  client,
  runId,
  approved,
  storedKeyId,
}: {
  client: ApiClient;
  runId: string;
  approved: boolean;
  storedKeyId: string | null;
}) {
  const [result, setResult] = useState<AscPushResult | null>(null);
  const [versionString, setVersionString] = useState("");
  const [cvResult, setCvResult] = useState<AscCreateVersionResult | null>(null);
  const [busy, setBusy] = useState<"push" | "cv" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No push affordance unless the run is approved AND a key is stored. This
  // guard is the safety boundary — there is no way to reach the push otherwise.
  if (!approved || !storedKeyId) return null;

  async function push() {
    setBusy("push");
    setError(null);
    setCvResult(null);
    try {
      // Stored key only — the .p8 is never sent from the device here.
      setResult(await ascPush(client, runId, { useStored: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  }

  async function createVersion() {
    const v = versionString.trim();
    if (!v) return;
    setBusy("cv");
    setError(null);
    try {
      setCvResult(await ascCreateVersion(client, runId, { useStored: true, versionString: v }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t create the version.");
    } finally {
      setBusy(null);
    }
  }

  const refused = result !== null && !result.ok;

  return (
    <Card>
      <AppText kind="lead">Push to App Store Connect</AppText>
      <AppText kind="micro">
        Uses your saved key ({storedKeyId}) to stage the approved copy on your editable version.
        Explicit tap — nothing is automatic, and your key never leaves the server.
      </AppText>
      <Button testID="asc-push" label="Push to App Store Connect" loading={busy === "push"} onPress={() => void push()} />

      {result ? (
        <AppText
          kind="micro"
          testID="push-result"
          style={{ color: result.ok ? palette.signal : palette.bad, marginTop: spacing.sm }}
        >
          {result.ok
            ? `Staged on your editable version: ${result.fieldsPushed.join(", ")}.`
            : `App Store Connect refused the push: ${result.reason}`}
        </AppText>
      ) : null}
      {error ? (
        <AppText kind="micro" testID="push-error" style={{ color: palette.bad, marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      {refused ? (
        <View testID="create-version" style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <AppText kind="micro">
            No editable version to push to? Create a draft (PREPARE_FOR_SUBMISSION) with your saved
            key, then push again.
          </AppText>
          <TextField testID="cv-version" value={versionString} onChangeText={setVersionString} placeholder="e.g. 1.2.0" />
          <Button
            testID="cv-create"
            label="Create draft version"
            variant="ghost"
            disabled={!versionString.trim()}
            loading={busy === "cv"}
            onPress={() => void createVersion()}
          />
          {cvResult ? (
            <AppText kind="micro" testID="cv-result" style={{ color: cvResult.ok ? palette.signal : palette.bad }}>
              {cvResult.ok
                ? `Created draft ${cvResult.versionString} (${cvResult.state}). Push again to stage your copy.`
                : `App Store Connect refused: ${cvResult.reason}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
