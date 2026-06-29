/**
 * War room — head-to-head competitor ranks for an app (Scale). Read-only; honest
 * "—" for any competitor we haven't checked. A 402 (below Scale) surfaces as an
 * upsell, not a crash.
 */
import React from "react";
import { ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../src/auth/AuthProvider.js";
import { warRoom } from "../../../src/api/endpoints.js";
import { WarRoomGrid } from "../../../src/components/WarRoomGrid.js";
import { EmptyState } from "../../../src/components/EmptyState.js";
import { Screen, AppText, Centered } from "../../../src/components/primitives.js";
import { ApiError } from "../../../src/api/errors.js";
import { palette } from "../../../src/theme/index.js";

export default function WarRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();

  const wr = useQuery({ queryKey: ["war-room", id], queryFn: () => warRoom(client, id!), enabled: !!id });

  if (wr.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;

  if (wr.isError) {
    const upsell = wr.error instanceof ApiError && wr.error.status === 402;
    return (
      <EmptyState
        title={upsell ? "War room is a Scale feature" : "Couldn’t load the war room"}
        detail={wr.error instanceof Error ? wr.error.message : "Try again."}
        {...(upsell ? {} : { cta: { label: "Retry", onPress: () => void wr.refetch() } })}
      />
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "War room", headerShown: true }} />
      <AppText kind="dim">As of {wr.data!.checkedAt} · {wr.data!.window}-day window</AppText>
      <WarRoomGrid rows={wr.data!.warRoom} competitors={wr.data!.competitors} />
    </Screen>
  );
}
