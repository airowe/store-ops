/**
 * Stored keys management (#67 Phase 2, mobile) — the write-only management view.
 * The API never returns key material; this renders metadata only. Delete is
 * honest: it removes the key from ShipASO but does NOT revoke it at Apple.
 *
 * NOTE the device invariant is untouched: credentials are stored ENCRYPTED ON
 * THE SERVER (envelope encryption), never on this device. The copy says so.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { deleteCredential, getCredentials, type StoredCredential } from "../api/endpoints.js";
import { AppText, Button, Card } from "./primitives.js";
import { spacing } from "../theme/index.js";

export function StoredKeysCard({ client }: { client: ApiClient }) {
  const [state, setState] = useState<{ enabled: boolean; credentials: StoredCredential[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getCredentials(client));
    } catch {
      setState({ enabled: false, credentials: [] });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(c: StoredCredential) {
    setBusy(c.id);
    setNote(null);
    try {
      await deleteCredential(client, c.kind, c.appId ?? undefined);
      await load();
      setNote("Deleted from ShipASO — revoke it at Apple too to fully kill it.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t delete.");
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <Card>
        <AppText kind="lead">Saved keys</AppText>
        <AppText kind="dim">Loading…</AppText>
      </Card>
    );
  }

  return (
    <Card>
      <AppText kind="lead">Saved keys</AppText>
      {!state.enabled ? (
        <View testID="stored-keys-disabled">
          <AppText kind="micro">
            Saving keys isn’t enabled on this deployment. Runs use your key once and never store it.
          </AppText>
        </View>
      ) : (
        <>
          <AppText kind="micro">
            Keys you chose to save are stored encrypted on our servers (write-only — usable and
            deletable, never viewable) so scheduled runs can read your live listing. Deleting here
            does not revoke the key at Apple — do that in App Store Connect.
          </AppText>
          {state.credentials.length === 0 ? (
            <View testID="stored-keys-empty" style={{ marginTop: spacing.sm }}>
              <AppText kind="dim">No saved keys.</AppText>
            </View>
          ) : (
            state.credentials.map((c) => (
              <View
                key={c.id}
                testID={`stored-key-${c.id}`}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}
              >
                <View style={{ flex: 1 }}>
                  <AppText kind="body">
                    {(c.kind === "asc" ? "App Store Connect" : "Google Play") + (c.keyId ? " · " + c.keyId : "")}
                  </AppText>
                  <AppText kind="micro">
                    {(c.appId ? "" : "account-level · ") +
                      "saved " + (c.createdAt ? c.createdAt.slice(0, 10) : "") +
                      (c.lastUsedAt ? " · last used " + c.lastUsedAt.slice(0, 10) : " · never used")}
                  </AppText>
                </View>
                <Button
                  testID={`delete-key-${c.id}`}
                  label="Delete"
                  variant="ghost"
                  loading={busy === c.id}
                  onPress={() => void remove(c)}
                />
              </View>
            ))
          )}
        </>
      )}
      {note ? (
        <View testID="stored-keys-note" style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">{note}</AppText>
        </View>
      ) : null}
    </Card>
  );
}
