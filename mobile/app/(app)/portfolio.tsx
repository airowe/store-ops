/**
 * Portfolio — the Scale-tier roll-up across all apps. Below Scale → a clean 402
 * explanation (never a crash).
 *
 * The gate sells through NATIVE IAP. This screen once opened the web Stripe
 * checkout in the system browser, which App Review rejected under Guideline
 * 3.1.1 (submission a64749cd, 2026-07-29): paid digital content offered outside
 * In-App Purchase. The interim fix was to sell nothing and name shipaso.com,
 * which 3.1.3(b) permits. RevenueCat replaced that: the upgrade now happens
 * in-app via StoreKit, so `<TierGate>` renders the paywall here.
 *
 * What is still forbidden is the WEB checkout — `billingCheckout`,
 * `openBrowserAsync(url)`, `ExternalPurchaseLink`. Those are the paths 3.1.1
 * and 3.1.3 object to, and `packages/docpaths/noIapPurchasePath.test.mjs` still
 * fails on them. Native IAP is not one of them.
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
import { TierGate } from "../../src/components/TierGate.js";
import { ApiError } from "../../src/api/errors.js";
import { useLayout } from "../../src/theme/responsive.js";
import { usePalette } from "../../src/theme/index.js";

export default function Portfolio() {
  const palette = usePalette();
  const { client, me } = useAuth();
  const router = useRouter();
  const { columns } = useLayout();

  const pf = useQuery({ queryKey: ["portfolio"], queryFn: () => portfolio(client) });

  if (pf.isLoading) return <Centered><ActivityIndicator color={palette.signal} /></Centered>;

  if (pf.isError) {
    const upsell = pf.error instanceof ApiError && pf.error.status === 402;
    if (upsell) {
      return (
        <>
          <Stack.Screen options={{ title: "Portfolio", headerShown: true }} />
          <TierGate
            feature="Portfolio"
            requires="scale"
            {...(me?.tier ? { tier: me.tier } : {})}
            detail={
              pf.error instanceof Error ? pf.error.message : "The fleet roll-up needs the Scale plan."
            }
            onUnlocked={() => void pf.refetch()}
          />
        </>
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
