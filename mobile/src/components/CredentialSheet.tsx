/**
 * CredentialSheet — collect a credential to run a credentialed pass, then DROP it.
 *
 * Two variants: `asc` (.p8 + key/issuer ids) and `play` (service-account JSON).
 * The value lives ONLY in this component's local state; on submit it's handed to
 * the caller (which sends it once) and never written anywhere. There is no
 * persistence path here — see `lib/credentials.ts` and the never-persisted test.
 */
import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { palette, spacing } from "../theme/index.js";
import {
  readPickedCredential,
  validateAscCredential,
  validateServiceAccount,
  type AscCredential,
} from "../lib/credentials.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

export type AscSubmit = { kind: "asc"; cred: AscCredential };
export type PlaySubmit = { kind: "play"; serviceAccount: string };

export function CredentialSheet({
  variant,
  onSubmit,
  busy,
  submitLabel,
}: {
  variant: "asc" | "play";
  onSubmit: (v: AscSubmit | PlaySubmit) => void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const shared = { busy: !!busy, ...(submitLabel !== undefined ? { submitLabel } : {}) };
  return variant === "asc" ? (
    <AscSheet onSubmit={(v) => onSubmit(v)} {...shared} />
  ) : (
    <PlaySheet onSubmit={(v) => onSubmit(v)} {...shared} />
  );
}

async function pickFileText(): Promise<string | null> {
  // SECURITY: copyToCacheDirectory MUST stay false — a cache copy would write the
  // credential to disk, breaking the never-persisted invariant. We read the picked
  // document in place; readPickedCredential also deletes any staged cache copy.
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false });
  if (res.canceled || !res.assets?.[0]) return null;
  return readPickedCredential(res.assets[0].uri);
}

function AscSheet({ onSubmit, busy, submitLabel }: { onSubmit: (v: AscSubmit) => void; busy?: boolean; submitLabel?: string }) {
  const [p8, setP8] = useState("");
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const cred = { p8, keyId: keyId.trim(), issuerId: issuerId.trim() };
    const problem = validateAscCredential(cred);
    if (problem) return setError(problem);
    setError(null);
    onSubmit({ kind: "asc", cred });
  };

  return (
    <Card>
      <AppText kind="lead">App Store Connect (.p8)</AppText>
      <AppText kind="micro">Used once to read your live listing — never stored on this device.</AppText>
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <Button label="Pick .p8 file" variant="ghost" onPress={() => void pickFileText().then((t) => t && setP8(t))} testID="asc-pick" />
        <TextField testID="asc-p8" value={p8} onChangeText={setP8} placeholder="…or paste the .p8 contents" multiline />
        <TextField testID="asc-keyid" value={keyId} onChangeText={setKeyId} placeholder="Key ID" />
        <TextField testID="asc-issuer" value={issuerId} onChangeText={setIssuerId} placeholder="Issuer ID" />
        {error ? <AppText kind="dim" style={{ color: palette.bad }}>{error}</AppText> : null}
        <Button label={submitLabel ?? "Run read-and-improve"} onPress={submit} loading={!!busy} testID="asc-submit" />
      </View>
    </Card>
  );
}

function PlaySheet({ onSubmit, busy, submitLabel }: { onSubmit: (v: PlaySubmit) => void; busy?: boolean; submitLabel?: string }) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const problem = validateServiceAccount(json);
    if (problem) return setError(problem);
    setError(null);
    onSubmit({ kind: "play", serviceAccount: json });
  };

  return (
    <Card>
      <AppText kind="lead">Google Play (service account)</AppText>
      <AppText kind="micro">Used once to read your own listing — never stored on this device.</AppText>
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <Button label="Pick service-account JSON" variant="ghost" onPress={() => void pickFileText().then((t) => t && setJson(t))} testID="play-pick" />
        <TextField testID="play-json" value={json} onChangeText={setJson} placeholder="…or paste your service-account JSON" multiline />
        {error ? <AppText kind="dim" style={{ color: palette.bad }}>{error}</AppText> : null}
        <Button label={submitLabel ?? "Verify & audit"} onPress={submit} loading={!!busy} testID="play-submit" />
      </View>
    </Card>
  );
}
