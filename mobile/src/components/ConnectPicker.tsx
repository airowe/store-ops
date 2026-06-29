/**
 * ConnectPicker — search/resolve an app to connect, mirroring the web's connect
 * flow. Type a name / URL / id → `/resolve` → either it resolves to one app
 * (connect directly) or returns candidates to pick from, with paging ("show
 * more") and an honest not-found nudge. The actual connect + navigation is the
 * caller's job (passed via `onConnect`); this component owns the search UX.
 */
import React, { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { fontSize, palette, radius, spacing } from "../theme/index.js";
import type { ApiClient } from "../api/client.js";
import { resolve as resolveEndpoint } from "../api/endpoints.js";
import type { AppCandidate, ResolveResult } from "../types/api.js";
import { AppText, Button, Card } from "./primitives.js";

export function ConnectPicker({
  client,
  onConnect,
}: {
  client: ApiClient;
  onConnect: (candidate: AppCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [candidates, setCandidates] = useState<AppCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(offset: number) {
    const q = query.trim();
    if (!q) return;
    const first = offset === 0;
    first ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const res = await resolveEndpoint(client, q, offset);
      setResult(res);
      if (res.kind === "resolved" && res.candidates[0]) {
        // Exact match → connect immediately (id/URL path).
        onConnect(res.candidates[0]);
        return;
      }
      setCandidates((prev) => (first ? res.candidates : [...prev, ...res.candidates]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "search failed");
    } finally {
      first ? setLoading(false) : setLoadingMore(false);
    }
  }

  const notFound = result?.kind === "not-found";

  return (
    <Card>
      <AppText kind="lead">Connect an app</AppText>
      <View style={styles.searchRow}>
        <TextInput
          testID="connect-input"
          value={query}
          onChangeText={setQuery}
          placeholder="App name, App Store URL, or bundle id"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void runSearch(0)}
          returnKeyType="search"
          style={styles.input}
        />
      </View>
      <Button label="Search" onPress={() => void runSearch(0)} loading={loading} />

      {error ? <AppText kind="dim" style={{ color: palette.bad }}>{error}</AppText> : null}
      {notFound ? (
        <AppText kind="dim">No connectable app matched “{query.trim()}”. Try the exact App Store URL or bundle id.</AppText>
      ) : null}

      {candidates.length > 0 ? (
        <FlatList
          testID="candidate-list"
          scrollEnabled={false}
          data={candidates}
          keyExtractor={(c, i) => `${c.bundleId}-${i}`}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => <CandidateRow candidate={item} onPress={() => onConnect(item)} />}
          ListFooterComponent={
            result?.hasMore ? (
              <Pressable
                testID="show-more"
                onPress={() => void runSearch(candidates.length)}
                style={styles.showMore}
              >
                {loadingMore ? <ActivityIndicator color={palette.signal} /> : <AppText kind="dim" style={{ color: palette.signal }}>Show more</AppText>}
              </Pressable>
            ) : candidates.length > 0 ? (
              <AppText kind="micro" style={styles.endNote}>End of results</AppText>
            ) : null
          }
        />
      ) : null}
    </Card>
  );
}

function CandidateRow({ candidate, onPress }: { candidate: AppCandidate; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" testID={`candidate-${candidate.bundleId}`} onPress={onPress} style={styles.row}>
      <View style={{ flex: 1 }}>
        <AppText kind="body" numberOfLines={1}>{candidate.name}</AppText>
        <AppText kind="micro" numberOfLines={1}>
          {candidate.publisher ?? "unknown publisher"} · {candidate.bundleId}
        </AppText>
      </View>
      <AppText kind="dim" style={{ color: palette.signal }}>Connect</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: { marginTop: spacing.xs },
  input: {
    color: palette.ink,
    backgroundColor: palette.bg2,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: radius.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  sep: { height: 1, backgroundColor: palette.lineSoft },
  showMore: { paddingVertical: spacing.md, alignItems: "center" },
  endNote: { textAlign: "center", paddingTop: spacing.sm },
});
