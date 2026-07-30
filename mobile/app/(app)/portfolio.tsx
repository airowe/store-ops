/**
 * Portfolio — the Scale-tier roll-up across all apps. Below Scale → a clean 402
 * explanation (never a crash).
 *
 * The app SELLS NOTHING. It used to open the web Stripe checkout in the system
 * browser, which App Review rejected under Guideline 3.1.1 (submission
 * a64749cd, 2026-07-29): paid digital content offered outside In-App Purchase.
 * Apple permits three fixes — implement IAP, use the US External Purchase Link
 * entitlement, or sell nothing in the app (3.1.3(b): an app may ACCESS content
 * acquired elsewhere). We take the third: subscribing happens on the web, and
 * the app reads the resulting tier.
 *
 * So this screen explains the gate and stops. Do not add an upgrade button —
 * that is precisely what was rejected, and there is a guard for it
 * (packages/docpaths/noIapPurchasePath.test.mjs).
 */
import React from "react";
import { ActivityIndicator } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { portfolio } from "../../src/api/endpoints.js";
import { PortfolioRow } from "../../src/components/Portfolio.js";
import { Grid } from "../../src/components/Grid.js";
import { EmptyState } from "../../src/components/EmptyState.js";
import { Screen, AppText, Card, Centered } from "../../src/components/primitives.js";
import { ApiError } from "../../src/api/errors.js";
import { useLayout } from "../../src/theme/responsive.js";
import { usePalette } from "../../src/theme/index.js";

export default function Portfolio() {
  const palette = usePalette();
  const { client } = useAuth();
  const router = useRouter();
  const { columns } = useLayout();

  const pf = useQuery({ queryKey: ["portfolio"], queryFn: () => portfolio(client) });

  if (pf.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;

  if (pf.isError) {
    const upsell = pf.error instanceof ApiError && pf.error.status === 402;
    if (upsell) {
      return (
        <Screen topInset={false}>
          <Stack.Screen options={{ title: "Portfolio", headerShown: true }} />
          <Card>
            <AppText kind="title">Portfolio is a Scale feature</AppText>
            <AppText kind="dim">
              {pf.error instanceof Error ? pf.error.message : "The fleet roll-up needs the Scale plan."}
            </AppText>
            {/* No purchase here — see the note at the top of this file. Naming
                where plans are managed is allowed (3.1.3(b)); offering to sell
                is not. */}
            <AppText kind="dim">Plans are managed at shipaso.com.</AppText>
          </Card>
        </Screen>
      );
    }
    return (
      <EmptyState
        title="Couldn’t load your portfolio"
        detail={pf.error instanceof Error ? pf.error.message : "Try again."}
        cta={{ label: "Retry", onPress: () => void pf.refetch() }}
      />
    );
  }

  const d = pf.data!;
  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title: "Portfolio", headerShown: true }} />
      <Card>
        <AppText kind="title">{d.totalApps} apps</AppText>
        <AppText kind="dim">{d.pendingApprovals} awaiting approval · {d.appsTracked} tracked</AppText>
      </Card>
      <Grid columns={columns}>
        {d.cards.map((c) => (
          <PortfolioRow key={c.appId} card={c} onPress={(id) => router.push(`/(app)/apps/${id}`)} />
        ))}
      </Grid>
    </Screen>
  );
}
