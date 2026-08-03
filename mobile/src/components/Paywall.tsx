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
import { ActivityIndicator, Linking } from "react-native";
import { AppText, Button, Card } from "./primitives.js";
import type { Tier } from "../types/api.js";
import { legalUrls } from "../lib/legalUrls.js";
import { renewalSentence } from "../lib/subscriptionPeriod.js";
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

  const legal = legalUrls();

  return (
    <Card>
      <AppText kind="title">Upgrade</AppText>
      {state.packages.map((p) => (
        <React.Fragment key={p.id}>
          <Button
            testID={`paywall-buy-${p.id}`}
            label={`${p.title} — ${p.priceString}`}
            onPress={() => void buy(p.id)}
            disabled={busy}
          />
          {/* 3.1.2(c): what the subscriber gets, straight from the store
              listing — so it cannot drift from the text Apple reviewed. */}
          {p.description ? (
            <AppText kind="dim" testID={`paywall-includes-${p.id}`}>
              {p.description}
            </AppText>
          ) : null}
          {/* Duration, auto-renewal, and where to cancel. The rate clause
              disappears when the store did not report a period. */}
          <AppText kind="micro" testID={`paywall-terms-${p.id}`}>
            {renewalSentence(p.priceString, p.subscriptionPeriod)}
          </AppText>
        </React.Fragment>
      ))}
      <Button
        testID="paywall-restore"
        variant="ghost"
        label="Restore Purchases"
        onPress={() => void restore()}
        disabled={busy}
      />
      {/* Apple requires both to be reachable from a screen that sells a
          subscription. An unset URL renders NO control — a link to a 404 on a
          purchase screen is its own rejection. */}
      {legal.terms ? (
        <Button
          testID="paywall-terms-link"
          variant="ghost"
          label="Terms of Use"
          onPress={() => void Linking.openURL(legal.terms as string)}
        />
      ) : null}
      {legal.privacy ? (
        <Button
          testID="paywall-privacy-link"
          variant="ghost"
          label="Privacy Policy"
          onPress={() => void Linking.openURL(legal.privacy as string)}
        />
      ) : null}
      {error ? (
        <AppText kind="dim" testID="paywall-error">
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}
