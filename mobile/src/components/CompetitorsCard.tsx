/**
 * Competitors card (#72 parity) — the app's watch list on mobile. Discovery
 * suggests candidates from the app's tracked keywords; ONLY what the user
 * confirms is watched (a suggestion is never silently tracked), mirroring the
 * web card and the Worker's model exactly.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { ApiClient } from "../api/client.js";
import {
  addCompetitor,
  confirmCompetitor,
  discoverCompetitors,
  getCompetitors,
  removeCompetitor,
} from "../api/endpoints.js";
import type { Competitor } from "../types/api.js";
import { AppText, Button, Card } from "./primitives.js";
import { TextField } from "./TextField.js";
import { palette, spacing } from "../theme/index.js";

export function CompetitorsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const [rows, setRows] = useState<Competitor[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await getCompetitors(client, appId);
      setRows(r.competitors ?? []);
    } catch {
      setRows([]); // fail-open render; actions surface their own errors
    }
  }, [client, appId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(key: string, fn: () => Promise<{ competitors: Competitor[] }>) {
    setBusy(key);
    setNote(null);
    try {
      const r = await fn();
      setRows(r.competitors ?? []);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function discover() {
    setBusy("discover");
    setNote(null);
    try {
      const r = await discoverCompetitors(client, appId);
      setRows(r.competitors ?? []);
      setNote(
        r.note ??
          (r.discovered > 0
            ? `${r.discovered} candidate${r.discovered === 1 ? "" : "s"} found from your tracked keywords — confirm the real rivals.`
            : "No new candidates — your tracked keywords surfaced nothing you aren't already watching."),
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Discovery failed.");
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNote("Enter the competitor's App Store name.");
      return;
    }
    await act("add", () => addCompetitor(client, appId, trimmed));
    setName("");
  }

  return (
    <Card>
      <AppText kind="lead">Competitors</AppText>
      <AppText kind="micro">
        The sweep diffs each watched competitor’s visible listing (name, version, price, rating).
        Discovery suggests apps ranking for your tracked keywords — nothing is watched until you
        confirm it.
      </AppText>

      {rows === null ? (
        <AppText kind="dim">Loading…</AppText>
      ) : rows.length === 0 ? (
        <View testID="competitors-empty">
          <AppText kind="dim">
            No competitors yet — discover candidates from your tracked keywords, or add one by name.
          </AppText>
        </View>
      ) : (
        rows.map((r) => (
          <View
            key={r.key}
            testID={`competitor-${r.key}`}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}
          >
            <View style={{ flex: 1 }}>
              <AppText kind="body">{r.name || r.key}</AppText>
              <AppText kind="micro" style={r.status === "confirmed" ? { color: palette.signal } : undefined}>
                {r.status === "confirmed" ? "watched" : "suggested"}
              </AppText>
            </View>
            {r.status === "suggested" ? (
              <>
                <Button
                  testID={`watch-${r.key}`}
                  label="Watch"
                  variant="ghost"
                  loading={busy === r.key}
                  onPress={() => void act(r.key, () => confirmCompetitor(client, appId, r.key))}
                />
                <Button
                  testID={`dismiss-${r.key}`}
                  label="Dismiss"
                  variant="ghost"
                  onPress={() => void act(r.key, () => removeCompetitor(client, appId, r.key))}
                />
              </>
            ) : (
              <Button
                testID={`remove-${r.key}`}
                label="Remove"
                variant="ghost"
                onPress={() => void act(r.key, () => removeCompetitor(client, appId, r.key))}
              />
            )}
          </View>
        ))
      )}

      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <Button
          testID="discover-competitors"
          label="Discover competitors"
          variant="ghost"
          loading={busy === "discover"}
          onPress={() => void discover()}
        />
        <TextField
          testID="competitor-name"
          value={name}
          onChangeText={setName}
          placeholder="Add by App Store name (e.g. “Paprika”)"
          onSubmitEditing={() => void add()}
        />
        <Button testID="add-competitor" label="Add" variant="ghost" loading={busy === "add"} onPress={() => void add()} />
      </View>

      {note ? (
        <View testID="competitors-note" style={{ marginTop: spacing.sm }}>
          <AppText kind="micro">{note}</AppText>
        </View>
      ) : null}
    </Card>
  );
}
