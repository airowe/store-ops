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
import { Eyebrow, Headline } from "../../src/components/brand.js";
import { apiBase } from "../../src/lib/config.js";
import { fontSize, spacing, typeface, usePalette } from "../../src/theme/index.js";

/**
 * The native header, themed. Without this react-navigation paints its default
 * white bar with black text over the dark screen (and the status bar goes
 * unreadable) — the one light element left on the public surface.
 */
export function headerOptions(palette: { bg: string; ink: string; line: string }) {
  return {
    title: "Proof",
    headerShown: true,
    headerStyle: { backgroundColor: palette.bg },
    headerTintColor: palette.ink,
    headerTitleStyle: { fontFamily: typeface.title, color: palette.ink },
    headerShadowVisible: false,
  } as const;
}

export default function Proof() {
  const palette = usePalette();
  // Public route — a token-free client (proof needs no auth).
  const client = useMemo(() => createApiClient({ baseUrl: apiBase(), fetch: globalThis.fetch }), []);
  const p = useQuery({ queryKey: ["proof"], queryFn: () => proof(client) });

  if (p.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;
  if (p.isError || !p.data) {
    return (
      <Screen>
        <Stack.Screen options={headerOptions(palette)} />
        <AppText kind="dim">Couldn’t load proof right now.</AppText>
      </Screen>
    );
  }

  const d = p.data;
  const hasWins = d.totalWins > 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: "Proof", headerShown: true }} />
      <View style={{ gap: spacing.sm }}>
        <Eyebrow>proof, not promises</Eyebrow>
        <Headline>The receipts</Headline>
        <AppText kind="dim">
          Anonymized rank wins across every tracked app. Each one was observed, never estimated.
        </AppText>
      </View>
      {hasWins ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
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
  const palette = usePalette();
  return (
    <Card style={{ flexBasis: "47%", flexGrow: 1 }}>
      <AppText kind="micro" style={{ fontFamily: typeface.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</AppText>
      <AppText kind="display" style={{ color: palette.signal, fontSize: fontSize.title, lineHeight: fontSize.title * 1.2 }}>{value}</AppText>
    </Card>
  );
}
