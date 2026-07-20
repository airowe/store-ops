/**
 * ApiKeysCard (#93) — scoped "shipaso_…" agent API keys. A key lets an external
 * AI agent connect to the ShipASO MCP (/mcp) and run the audit → propose loop.
 *
 * Honest, load-bearing:
 *   • the raw key is shown ONCE, right after you generate it — we store only its
 *     hash, so we can never show it again (copy it then). It lives only in local
 *     state, never written to device storage;
 *   • read/draft only: an agent can audit + propose but can NEVER push;
 *   • revoke is immediate and independent of your login (doesn't touch the session).
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../api/endpoints.js";
import type { ApiKeyMeta } from "../types/api.js";
import { palette, radius, spacing } from "../theme/index.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";

export function ApiKeysCard({ client }: { client: ApiClient }) {
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null);
  const [label, setLabel] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listApiKeys(client);
      setKeys(r.keys ?? []);
    } catch {
      setKeys([]); // fail-open render; actions surface their own errors
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusy("create");
    setError(null);
    try {
      const k = await createApiKey(client, trimmed);
      setFreshKey(k.key); // shown ONCE — local state only, never persisted
      setLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t generate a key.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(`revoke-${id}`);
    setError(null);
    try {
      await revokeApiKey(client, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t revoke that key.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <AppText kind="lead">Agent access (API keys)</AppText>
      <AppText kind="micro">
        Generate a scoped key so your AI agent can connect to the ShipASO MCP and run the audit →
        propose loop. Read-only + draft: an agent can never push — approving and shipping stay here.
        Revoke any time; it can’t touch your login.
      </AppText>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <TextField testID="ak-label" value={label} onChangeText={setLabel} placeholder="Label (e.g. Claude Code)" />
        <Button
          testID="ak-create"
          label="Generate key"
          variant="ghost"
          disabled={!label.trim()}
          loading={busy === "create"}
          onPress={() => void create()}
        />
      </View>

      {freshKey ? (
        <View
          testID="ak-fresh"
          style={{ borderColor: palette.line, borderWidth: 1, borderRadius: radius.base, padding: spacing.sm, marginTop: spacing.sm }}
        >
          <AppText kind="micro">Copy your key now — we only show it once (we store just its hash):</AppText>
          <AppText kind="mono" testID="ak-fresh-value" selectable style={{ marginTop: spacing.xs }}>
            {freshKey}
          </AppText>
        </View>
      ) : null}

      {keys && keys.length > 0 ? (
        <View testID="ak-list" style={{ marginTop: spacing.sm }}>
          {keys.map((k) => (
            <View
              key={k.id}
              testID={`ak-${k.id}`}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs }}
            >
              <AppText kind="mono" style={{ flex: 1 }}>
                {k.prefix}
                {k.label ? ` · ${k.label}` : ""}
              </AppText>
              <Button
                testID={`ak-revoke-${k.id}`}
                label="Revoke"
                variant="ghost"
                loading={busy === `revoke-${k.id}`}
                onPress={() => void revoke(k.id)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <AppText kind="micro" testID="ak-error" style={{ color: palette.bad }}>
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}
