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
import { TierGate } from "../../../src/components/TierGate.js";
import { ApiError } from "../../../src/api/errors.js";
import { usePalette } from "../../../src/theme/index.js";

export default function WarRoomScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, me } = useAuth();

  const wr = useQuery({ queryKey: ["war-room", id], queryFn: () => warRoom(client, id!), enabled: !!id });

  if (wr.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;

  if (wr.isError) {
    const upsell = wr.error instanceof ApiError && wr.error.status === 402;
    if (upsell) {
      // Below Scale → offer the upgrade in-app (native IAP) rather than a dead
      // end. See the note in TierGate for why this is not the 3.1.1 path.
      return (
        <>
          <Stack.Screen options={{ title: "War room", headerShown: true }} />
          <TierGate
            feature="War room"
            requires="scale"
            {...(me?.tier ? { tier: me.tier } : {})}
            {...(wr.error instanceof Error ? { detail: wr.error.message } : {})}
            onUnlocked={() => void wr.refetch()}
          />
        </>
      );
    }
    return (
      <EmptyState
        title="Couldn’t load the war room"
        detail={wr.error instanceof Error ? wr.error.message : "Try again."}
        cta={{ label: "Retry", onPress: () => void wr.refetch() }}
      />
    );
  }

  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title: "War room", headerShown: true }} />
      <AppText kind="dim">As of {wr.data!.checkedAt} · {wr.data!.window}-day window</AppText>
      <WarRoomGrid rows={wr.data!.warRoom} competitors={wr.data!.competitors} />
    </Screen>
  );
}
