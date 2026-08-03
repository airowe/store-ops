/**
 * The shared 402 surface: what this feature is, which tier it needs, and a
 * native way to get there.
 *
 * ShipASO 0.1.0 was rejected under Guideline 3.1.1 for opening a Stripe
 * checkout in the system browser. The fix at the time was to sell nothing —
 * these screens named the tier and pointed at shipaso.com, which 3.1.3(b)
 * permits. RevenueCat changes the calculus: the app now sells through native
 * In-App Purchase, so the honest thing is to offer the upgrade here rather than
 * send the user out of the app to buy (the very steering 3.1.1 objects to).
 *
 * The web checkout stays forbidden. `packages/docpaths/noIapPurchasePath.test.mjs`
 * still fails on `billingCheckout` / `openBrowserAsync(url)` /
 * `ExternalPurchaseLink` — native IAP is not one of those paths.
 *
 * Both gated screens (portfolio, war room) render this, so the rules live in
 * one tested place instead of being restated per screen.
 */
import React from "react";
import { AppText, Card, Screen } from "./primitives.js";
import { Paywall } from "./Paywall.js";
import type { Tier } from "../types/api.js";

const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  indie: "Indie",
  startup: "Startup",
  scale: "Scale",
};

export function TierGate({
  feature,
  requires,
  tier,
  detail,
  onUnlocked,
}: {
  /** Human name of the gated feature, e.g. "Portfolio". */
  feature: string;
  /** The tier that unlocks it. */
  requires: Tier;
  /** The user's current tier, passed through so the paywall can show a
   *  read-only state for a web subscriber (3.1.3). */
  tier?: Tier;
  /** The server's own 402 message, when it sent one. */
  detail?: string;
  /** Called after a successful purchase so the caller can refetch. */
  onUnlocked?: () => void;
}) {
  // No <Stack.Screen> here: the screen that renders this owns its own header,
  // and importing expo-router into a shared component pulls untransformed ESM
  // into every test that mounts it.
  return (
    <Screen topInset={false}>
      <Card>
        <AppText kind="title">
          {feature} is a {TIER_LABEL[requires]} feature
        </AppText>
        {detail ? <AppText kind="dim">{detail}</AppText> : null}
      </Card>
      {/* The upgrade path is native IAP. Deliberately NOT a link to the web —
          steering out of the app to buy is what 3.1.1 objects to, and the
          paywall carries the subscription disclosures Apple requires. */}
      <Paywall {...(tier !== undefined ? { tier } : {})} {...(onUnlocked ? { onDone: onUnlocked } : {})} />
    </Screen>
  );
}
