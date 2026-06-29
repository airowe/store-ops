/**
 * App detail — the app's identity, rank movement, and its run history. Tapping a
 * run opens the run detail ("money screen"). Read-only; honest movement (an
 * unchecked keyword stays "—", never a guessed number).
 */
import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../src/auth/AuthProvider.js";
import { getApp, getDeltas } from "../../../src/api/endpoints.js";
import { RankMovementRow } from "../../../src/components/RankMovementRow.js";
import { EmptyState } from "../../../src/components/EmptyState.js";
import { Screen, AppText, Card, Centered } from "../../../src/components/primitives.js";
import { humanizeStatus, timeAgo } from "../../../src/lib/format.js";
import { palette, spacing } from "../../../src/theme/index.js";

export default function AppDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const router = useRouter();
  const now = Date.now();

  const app = useQuery({ queryKey: ["app", id], queryFn: () => getApp(client, id!), enabled: !!id });
  const deltas = useQuery({ queryKey: ["deltas", id], queryFn: () => getDeltas(client, id!), enabled: !!id });

  if (app.isLoading) {
    return <Centered><ActivityIndicator color={palette.signal} /></Centered>;
  }
  if (app.isError || !app.data) {
    return (
      <EmptyState
        title="Couldn’t load this app"
        detail={app.error instanceof Error ? app.error.message : "Try again."}
        cta={{ label: "Retry", onPress: () => void app.refetch() }}
      />
    );
  }

  const { app: a, runs } = app.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: a.name, headerShown: true }} />
      <AppText kind="dim">{a.bundle_id} · {a.country}</AppText>

      {deltas.data && deltas.data.entries.length > 0 ? (
        <Card>
          <AppText kind="lead">Rank movement</AppText>
          {deltas.data.entries.slice(0, 8).map((e) => (
            <RankMovementRow key={e.keyword} entry={e} />
          ))}
        </Card>
      ) : null}

      <AppText kind="title">Runs</AppText>
      {runs.length === 0 ? (
        <AppText kind="dim">No runs yet.</AppText>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {runs.map((r) => (
            <Pressable key={r.id} testID={`run-${r.id}`} onPress={() => router.push(`/(app)/runs/${r.id}`)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText kind="body">{humanizeStatus(r.status)}</AppText>
                  <AppText kind="micro">{timeAgo(r.created_at, now)}</AppText>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
