/**
 * Paywall — native in-app purchase upgrade UI (RevenueCat).
 *
 * Four states, resolved on mount:
 *   • loading    — fetching the offering + current entitlement.
 *   • managed-web — the user is on a PAID tier but has NO active IAP entitlement,
 *     so that tier was bought on the web (Stripe). Guideline 3.1.3: show it
 *     read-only — never a purchase button, never a link to web checkout.
 *   • unavailable — no offering (RevenueCat not provisioned yet / no packages).
 *   • ready      — render the packages with native Buy buttons + Restore.
 *
 * Purchases go through StoreKit / Play Billing via the wrapper's native path; the
 * server tier updates asynchronously via the RevenueCat webhook, so on success we
 * call `onDone` (the parent refreshes `me`). This component imports NO SDK types —
 * only the app-shaped wrapper in `../lib/purchases.js`.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { AppText, Button, Card } from "./primitives.js";
import type { Tier } from "../types/api.js";
import {
  fetchOfferingPackages,
  hasActiveIapEntitlement,
  purchasePackageById,
  restorePurchases,
  type PaywallPackage,
} from "../lib/purchases.js";

const PAID_TIERS: Tier[] = ["indie", "startup", "scale"];
const isPaid = (t?: Tier): boolean => !!t && PAID_TIERS.includes(t);

type LoadState =
  | { phase: "loading" }
  | { phase: "managed-web" }
  | { phase: "unavailable" }
  | { phase: "ready"; packages: PaywallPackage[] };

export function Paywall({ tier, onDone }: { tier?: Tier; onDone?: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    const [packages, iapActive] = await Promise.all([
      fetchOfferingPackages(),
      hasActiveIapEntitlement(),
    ]);
    // A paid tier with no active IAP entitlement was purchased on the web.
    if (isPaid(tier) && !iapActive) {
      setState({ phase: "managed-web" });
      return;
    }
    setState(packages.length === 0 ? { phase: "unavailable" } : { phase: "ready", packages });
  }, [tier]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async (id: string) => {
    setBusy(true);
    setError(null);
    const outcome = await purchasePackageById(id);
    setBusy(false);
    if (outcome === "purchased") onDone?.();
    else if (outcome === "error") setError("That purchase didn’t go through. Please try again.");
    // "cancelled" → the user backed out; say nothing.
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    const restored = await restorePurchases();
    setBusy(false);
    if (restored) onDone?.();
    else setError("No purchases to restore.");
  };

  if (state.phase === "loading") {
    return (
      <Card>
        <ActivityIndicator testID="paywall-loading" />
      </Card>
    );
  }

  if (state.phase === "managed-web") {
    return (
      <Card>
        <AppText kind="title" testID="paywall-managed-web">
          You’re on {tier}
        </AppText>
        <AppText kind="dim">Your subscription is managed on the web.</AppText>
      </Card>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <Card>
        <AppText kind="title">Upgrade</AppText>
        <AppText kind="dim" testID="paywall-unavailable">
          In-app purchases aren’t available right now.
        </AppText>
      </Card>
    );
  }

  return (
    <Card>
      <AppText kind="title">Upgrade</AppText>
      {state.packages.map((p) => (
        <Button
          key={p.id}
          testID={`paywall-buy-${p.id}`}
          label={`${p.title} — ${p.priceString}`}
          onPress={() => void buy(p.id)}
          disabled={busy}
        />
      ))}
      <Button
        testID="paywall-restore"
        variant="ghost"
        label="Restore Purchases"
        onPress={() => void restore()}
        disabled={busy}
      />
      {error ? (
        <AppText kind="dim" testID="paywall-error">
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}
