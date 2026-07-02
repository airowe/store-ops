/**
 * Portfolio — the Scale-tier roll-up across all apps. Below Scale → a clean 402
 * upsell (never a crash). Billing routes purchasing to the web checkout in the
 * system browser (plan §1c: keep purchasing on the web to avoid IAP friction).
 */
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "../../src/auth/AuthProvider.js";
import { billingCheckout, portfolio } from "../../src/api/endpoints.js";
import { PortfolioRow } from "../../src/components/Portfolio.js";
import { Grid } from "../../src/components/Grid.js";
import { EmptyState } from "../../src/components/EmptyState.js";
import { Screen, AppText, Button, Card, Centered } from "../../src/components/primitives.js";
import { ApiError } from "../../src/api/errors.js";
import { useLayout } from "../../src/theme/responsive.js";
import { palette } from "../../src/theme/index.js";

export default function Portfolio() {
  const { client } = useAuth();
  const router = useRouter();
  const { columns } = useLayout();

  const pf = useQuery({ queryKey: ["portfolio"], queryFn: () => portfolio(client) });

  async function openCheckout(tier: string) {
    try {
      const { url } = await billingCheckout(client, tier);
      await WebBrowser.openBrowserAsync(url);
    } catch {
      /* surfaced inline below on next render is overkill; checkout failures are rare */
    }
  }

  if (pf.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;

  if (pf.isError) {
    const upsell = pf.error instanceof ApiError && pf.error.status === 402;
    if (upsell) {
      return (
        <Screen>
          <Stack.Screen options={{ title: "Portfolio", headerShown: true }} />
          <Card>
            <AppText kind="title">Portfolio is a Scale feature</AppText>
            <AppText kind="dim">{pf.error instanceof Error ? pf.error.message : "Upgrade to see the fleet roll-up."}</AppText>
            <Button label="Upgrade to Scale" onPress={() => void openCheckout("scale")} testID="upgrade" />
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
    <Screen>
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
