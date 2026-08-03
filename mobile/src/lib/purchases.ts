/**
 * RevenueCat (in-app purchase) wrapper — the ONLY module that imports the SDK.
 *
 * Everything else (the paywall, AuthProvider) depends on this small, app-shaped
 * surface, so the SDK is mockable in one place and swappable if it ever changes.
 * Every call degrades safely when RevenueCat is not configured (no API key yet —
 * Workstream A): reads return empty/false and writes no-op, so a build without
 * RevenueCat provisioned still runs and the paywall shows an "unavailable" state
 * instead of crashing.
 *
 * Compliance: purchases go through StoreKit / Play Billing via
 * `Purchases.purchasePackage` (native IAP). This module never opens a web
 * checkout URL — that path (Stripe `billingCheckout` / `openBrowserAsync`) is the
 * Guideline 3.1.1/3.1.3 violation the app must avoid; the web keeps Stripe.
 */
import { Platform } from "react-native";
import Purchases, { type CustomerInfo, type PurchasesPackage } from "react-native-purchases";
import { revenueCatApiKey } from "./config.js";

let configured = false;

/**
 * Configure the SDK once (idempotent). Returns false when no API key is set for
 * this platform, leaving the module inert. `appUserId` should be our user id so
 * the IAP webhook's `app_user_id` resolves to the same user; omit it to configure
 * anonymously (a purchase before sign-in stays anonymous until `login`).
 */
export function configurePurchases(appUserId?: string | null): boolean {
  if (configured) return true;
  const apiKey = revenueCatApiKey();
  if (!apiKey) return false;
  Purchases.configure({ apiKey, appUserID: appUserId ?? null });
  configured = true;
  return true;
}

export function isPurchasesConfigured(): boolean {
  return configured;
}

/** Alias the RevenueCat identity to our user id (call on sign-in). No-op when unconfigured. */
export async function loginPurchases(appUserId: string): Promise<void> {
  if (!configured) return;
  await Purchases.logIn(appUserId);
}

/** Drop back to an anonymous RevenueCat identity (call on sign-out). No-op when unconfigured. */
export async function logoutPurchases(): Promise<void> {
  if (!configured) return;
  await Purchases.logOut();
}

/** An app-shaped purchasable package — no SDK types leak past this module. */
export type PaywallPackage = {
  /** RevenueCat package identifier (what `purchase` takes). */
  id: string;
  /** Store product id (App Store / Play) — matches the cloud REVENUECAT_PRODUCT_* map. */
  productId: string;
  /** Localized price string, e.g. "$7.00". */
  priceString: string;
  /** Localized product title. */
  title: string;
  /**
   * Localized store description — what the subscriber gets, as configured in
   * App Store Connect / Play Console. This is the 3.1.2(c) "clearly describe
   * what the user will get for the price" surface, and it comes from the store
   * rather than from app copy so it cannot drift from what was reviewed.
   * Empty when unset.
   */
  description: string;
  /**
   * ISO 8601 subscription period ("P1M", "P1Y"), or null when the store does
   * not report one — StoreKit 1 on iOS cannot always determine it and Amazon
   * never provides it. Required for the 3.1.2(c) duration disclosure, and
   * deliberately nullable so the paywall omits the clause instead of guessing.
   */
  subscriptionPeriod: string | null;
};

function toPaywallPackage(p: PurchasesPackage): PaywallPackage {
  return {
    id: p.identifier,
    productId: p.product.identifier,
    priceString: p.product.priceString,
    title: p.product.title,
    description: p.product.description ?? "",
    subscriptionPeriod: p.product.subscriptionPeriod ?? null,
  };
}

/** The current offering's packages, or [] when unconfigured / no offering set. */
export async function fetchOfferingPackages(): Promise<PaywallPackage[]> {
  if (!configured) return [];
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  return current.availablePackages.map(toPaywallPackage);
}

export type PurchaseOutcome = "purchased" | "cancelled" | "error";

/**
 * Purchase a package by id via native IAP. Returns 'cancelled' when the user
 * backs out (RevenueCat sets `userCancelled`), 'error' on anything else. The
 * server tier updates asynchronously via the RevenueCat webhook; the caller
 * refreshes `me` on success (and the CustomerInfo listener catches renewals).
 */
export async function purchasePackageById(packageId: string): Promise<PurchaseOutcome> {
  if (!configured) return "error";
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find((p) => p.identifier === packageId);
  if (!pkg) return "error";
  try {
    await Purchases.purchasePackage(pkg);
    return "purchased";
  } catch (e) {
    if (e && typeof e === "object" && (e as { userCancelled?: boolean }).userCancelled) {
      return "cancelled";
    }
    return "error";
  }
}

/** Restore prior purchases (Apple requires this affordance). Returns whether an entitlement is now active. */
export async function restorePurchases(): Promise<boolean> {
  if (!configured) return false;
  return hasActiveEntitlement(await Purchases.restorePurchases());
}

/** Does RevenueCat show an active IAP entitlement for this user right now? */
export async function hasActiveIapEntitlement(): Promise<boolean> {
  if (!configured) return false;
  return hasActiveEntitlement(await Purchases.getCustomerInfo());
}

function hasActiveEntitlement(info: CustomerInfo): boolean {
  return Object.keys(info.entitlements?.active ?? {}).length > 0;
}

/** Fire `cb` whenever RevenueCat's customer info changes (purchase, renewal, expiry). */
export function onCustomerInfoUpdate(cb: () => void): void {
  if (!configured) return;
  Purchases.addCustomerInfoUpdateListener(() => cb());
}

/** Platform label for logging/paywall copy. */
export function purchasesPlatform(): "ios" | "android" | "other" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "other";
}
