/**
 * Proof — public, anonymized aggregate wins (no app/user data). Cached, reachable
 * logged-out. Honest: when there are no wins yet, it says so rather than inventing
 * numbers.
 */
import React, { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { createApiClient } from "../../src/api/client.js";
import { proof } from "../../src/api/endpoints.js";
import { Screen, AppText, Card, Centered } from "../../src/components/primitives.js";
import { apiBase } from "../../src/lib/config.js";
import { palette, spacing } from "../../src/theme/index.js";

export default function Proof() {
  // Public route — a token-free client (proof needs no auth).
  const client = useMemo(() => createApiClient({ baseUrl: apiBase(), fetch: globalThis.fetch }), []);
  const p = useQuery({ queryKey: ["proof"], queryFn: () => proof(client) });

  if (p.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;
  if (p.isError || !p.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Proof", headerShown: true }} />
        <AppText kind="dim">Couldn’t load proof right now.</AppText>
      </Screen>
    );
  }

  const d = p.data;
  const hasWins = d.totalWins > 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: "Proof", headerShown: true }} />
      <AppText kind="display">The receipts</AppText>
      {hasWins ? (
        <View style={{ gap: spacing.md }}>
          <Stat label="Apps with measured wins" value={String(d.appsWithWins)} />
          <Stat label="Total rank wins" value={String(d.totalWins)} />
          <Stat label="Best improvement" value={`${d.bestImprovement} places`} />
          <Stat label="Median improvement" value={`${d.medianImprovement} places`} />
        </View>
      ) : (
        <AppText kind="dim">No measured wins to show yet — we only count real, observed climbs.</AppText>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <AppText kind="micro">{label}</AppText>
      <AppText kind="title" style={{ color: palette.signal }}>{value}</AppText>
    </Card>
  );
}
