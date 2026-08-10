/**
 * Stripe billing + tier gates.
 *
 * No Stripe SDK — it's heavy for Workers. We call the Stripe REST API directly
 * with `fetch` (the secret key as a Bearer), and verify webhooks with Web Crypto
 * HMAC-SHA256 (the same primitive auth.ts uses), constant-time. Everything here
 * is pure or fetch-injected so it tests without the real Stripe API or a DB.
 *
 * Tiers (see commercial/OFFER.md):
 *   free    — run-it-yourself; manual runs only, 1 app, NO cron autonomy
 *   indie   — $6.99/mo; weekly cron autonomy, small portfolio
 *   startup — $19/mo; weekly cron autonomy, mid portfolio
 *   scale   — $65/mo; portfolio across many apps
 *
 * All paid tiers are recurring subscriptions — there is no one-time tier.
 */
import type { Tier } from "./d1.js";
import { constantTimeEqual } from "./auth.js";

const STRIPE_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

/** Default tolerance (Stripe's own recommendation) for webhook replay. */
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

// ── tier gates (pure) ────────────────────────────────────────────────────────────

/** Max connected apps allowed for a tier. */
export function appLimitForTier(tier: Tier): number {
  switch (tier) {
    case "free":
      return 1;
    case "indie":
      return 3;
    case "startup":
      return 10;
    case "scale":
      return 50;
  }
}

/** Only the recurring (paid) tiers get the weekly autonomous sweep. */
export function canRunCron(tier: Tier): boolean {
  return tier === "indie" || tier === "startup" || tier === "scale";
}

/**
 * May ShipASO perform an App Store Connect WRITE on this user's behalf —
 * uploading a screenshot set, creating a PPO experiment or a Custom Product
 * Page (#374)? Reading a listing stays free; acting on it is a paid convenience,
 * the same principle `canRunCron` already applies to autonomy.
 *
 * AVAILABILITY ONLY — this is not consent. A write additionally requires the
 * user's own opt-in (`users.asc_write_opt_in`, default OFF), an approved run,
 * and an explicit click. Being on a paid plan must never mean writes start
 * happening silently.
 */
export function canAscWrite(tier: Tier): boolean {
  return canRunCron(tier);
}

// ── tier ⇄ Stripe price mapping ───────────────────────────────────────────────────

export type StripePriceEnv = {
  STRIPE_PRICE_INDIE?: string;
  STRIPE_PRICE_STARTUP?: string;
  STRIPE_PRICE_SCALE?: string;
};

type PaidTier = Exclude<Tier, "free">;
type CheckoutMode = "payment" | "subscription";

/** Static per-tier checkout shape: which env price + which Stripe mode. All
 * paid tiers are recurring subscriptions. */
const TIER_CONFIG: Record<PaidTier, { envKey: keyof StripePriceEnv; mode: CheckoutMode }> = {
  indie: { envKey: "STRIPE_PRICE_INDIE", mode: "subscription" }, // $6.99/mo (App Store; Stripe bills $7)
  startup: { envKey: "STRIPE_PRICE_STARTUP", mode: "subscription" }, // $19/mo
  scale: { envKey: "STRIPE_PRICE_SCALE", mode: "subscription" }, // $65/mo
};

/** Resolve a paid tier to its concrete Stripe price id + checkout mode. */
export function stripeCheckoutParams(
  tier: Tier,
  prices: StripePriceEnv,
): { priceId: string; mode: CheckoutMode } {
  if (tier === "free") throw new Error("cannot create a checkout for the free tier");
  const cfg = TIER_CONFIG[tier];
  const priceId = prices[cfg.envKey];
  if (!priceId) throw new Error(`${cfg.envKey} is not configured`);
  return { priceId, mode: cfg.mode };
}

/** Reverse map a Stripe price id back to a tier (for webhook → tier resolution). */
export function tierForPriceId(priceId: string, prices: StripePriceEnv): Tier | null {
  if (priceId && priceId === prices.STRIPE_PRICE_INDIE) return "indie";
  if (priceId && priceId === prices.STRIPE_PRICE_STARTUP) return "startup";
  if (priceId && priceId === prices.STRIPE_PRICE_SCALE) return "scale";
  return null;
}

// ── effective tier across payment sources (Stripe web + RevenueCat IAP) ───────────
//
// A user can hold BOTH a web (Stripe) subscription and an in-app (RevenueCat)
// subscription. Policy (decided 2026-08-01): the HIGHEST active tier wins. Each
// source records the tier it currently grants ('free' when its sub ends); the
// effective tier every gate reads is the higher-ranked of the two. No status
// coupling is needed here — each webhook path sets ITS OWN source tier to 'free'
// when that subscription cancels/expires, so a paid source tier always means active.

const TIER_RANK: Record<Tier, number> = { free: 0, indie: 1, startup: 2, scale: 3 };

/** Numeric rank for ordering tiers (free < indie < startup < scale). */
export function tierRank(tier: Tier): number {
  return TIER_RANK[tier];
}

/**
 * The effective tier a user gets from their two possible subscription sources:
 * the higher-ranked of the Stripe-granted and IAP-granted tiers. A `null`/absent
 * source counts as 'free' (that source grants nothing).
 */
export function effectiveTier(
  stripeTier: Tier | null | undefined,
  iapTier: Tier | null | undefined,
): Tier {
  const a = stripeTier ?? "free";
  const b = iapTier ?? "free";
  return tierRank(a) >= tierRank(b) ? a : b;
}

// ── tier ⇄ RevenueCat product mapping ─────────────────────────────────────────────

export type RevenuecatProductEnv = {
  REVENUECAT_PRODUCT_INDIE?: string;
  REVENUECAT_PRODUCT_STARTUP?: string;
  REVENUECAT_PRODUCT_SCALE?: string;
};

/**
 * Reverse map a store product id (App Store / Play) to a tier — the IAP webhook's
 * tier resolution, mirroring `tierForPriceId` on the Stripe side.
 */
export function tierForIapProduct(
  productId: string,
  products: RevenuecatProductEnv,
): Tier | null {
  if (productId && productId === products.REVENUECAT_PRODUCT_INDIE) return "indie";
  if (productId && productId === products.REVENUECAT_PRODUCT_STARTUP) return "startup";
  if (productId && productId === products.REVENUECAT_PRODUCT_SCALE) return "scale";
  return null;
}

// ── RevenueCat webhook event → the pure tier/status decision ───────────────────────
//
// RevenueCat POSTs `{ event: { type, app_user_id, product_id, expiration_at_ms } }`.
// The app calls `Purchases.logIn(userId)`, so `app_user_id` IS our user id — no
// customer-map lookup (unlike Stripe). This is the testable brain; the HTTP handler
// in api/index.ts does the auth + DB writes. `null` ⇒ acknowledge (200) but ignore.

export type RevenuecatEvent = {
  event?: {
    type?: string;
    app_user_id?: string;
    product_id?: string;
    expiration_at_ms?: number | null;
  };
};

/**
 * What the IAP webhook should persist for a user. Omitted fields are left
 * untouched; `iapTier: 'free'` revokes the IAP grant.
 */
export type RevenuecatDecision = {
  appUserId: string;
  iapTier?: Tier | null;
  iapStatus?: string;
  iapProductId?: string | null;
  iapPeriodEnd?: string | null;
};

const RC_GRANT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);

/** RevenueCat sends `expiration_at_ms` in unix MILLISECONDS (Stripe uses seconds). */
function isoFromMs(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Decide the IAP state change for a RevenueCat event.
 *   INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION / NON_RENEWING
 *                       → grant the product's tier (status 'active')
 *   CANCELLATION        → keep the tier (access runs to expiration), mark 'cancelled'
 *   EXPIRATION          → revoke: tier 'free', mark 'expired'
 *   BILLING_ISSUE       → keep the tier (grace), mark 'billing_issue'
 *   SUBSCRIPTION_PAUSED → keep the tier (RC fires EXPIRATION when access is truly
 *                         lost), mark 'paused'
 *   unknown type / unmappable product → null (acknowledge + ignore)
 */
export function revenuecatOutcome(
  evt: RevenuecatEvent,
  products: RevenuecatProductEnv,
): RevenuecatDecision | null {
  const e = evt.event;
  if (!e || typeof e.type !== "string" || !e.app_user_id) return null;
  const appUserId = e.app_user_id;
  const type = e.type.toUpperCase();

  if (RC_GRANT_TYPES.has(type)) {
    const tier = e.product_id ? tierForIapProduct(e.product_id, products) : null;
    if (!tier) return null; // unknown product — acknowledge but change nothing
    return {
      appUserId,
      iapTier: tier,
      iapStatus: "active",
      iapProductId: e.product_id ?? null,
      iapPeriodEnd: isoFromMs(e.expiration_at_ms),
    };
  }
  if (type === "CANCELLATION") return { appUserId, iapStatus: "cancelled" };
  if (type === "EXPIRATION")
    return { appUserId, iapTier: "free", iapStatus: "expired", iapPeriodEnd: null };
  if (type === "BILLING_ISSUE") return { appUserId, iapStatus: "billing_issue" };
  if (type === "SUBSCRIPTION_PAUSED") return { appUserId, iapStatus: "paused" };
  return null;
}

// ── Dunning (failed-payment recovery) — PURE decision + email composer ────────────
//
// The webhook I/O lives in api/index.ts; these two functions are the testable
// brain. `dunningOutcome` decides the state transition + which email to queue;
// `dunningEmail` composes the plain, single-CTA message. Neither touches the DB,
// Stripe, or the mail transport.

/** Which recovery email to send, if any. */
export type DunningEmailKind = "past_due" | "recovered";

/** The pure decision for a billing event given the account's current status. */
export type DunningDecision = {
  /** The status to persist, when the event changes it. */
  newStatus?: string;
  /** The recovery email to queue, `null`/absent when none. */
  sendEmail?: DunningEmailKind | null;
};

/**
 * Decide the dunning transition for a Stripe invoice event.
 *
 *   invoice.payment_failed                  → past_due  + past_due nudge
 *   invoice.payment_succeeded (was past_due) → active    + recovered email
 *   invoice.payment_succeeded (was active)   → {} (normal renewal, no-op)
 *   anything else                            → {}
 */
export function dunningOutcome(eventType: string, currentStatus: string): DunningDecision {
  if (eventType === "invoice.payment_failed") {
    return { newStatus: "past_due", sendEmail: "past_due" };
  }
  if (eventType === "invoice.payment_succeeded") {
    // Only a *recovery* from past_due is interesting; a success on an
    // already-active account is just a normal renewal — say nothing.
    if (currentStatus === "past_due") {
      return { newStatus: "active", sendEmail: "recovered" };
    }
    return {};
  }
  return {};
}

/** Compose a plain, one-CTA recovery email. Pure — caller injects the URL. */
export function dunningEmail(
  kind: DunningEmailKind,
  opts: { dashboardUrl: string },
): { subject: string; html: string; text: string } {
  const { dashboardUrl } = opts;
  if (kind === "past_due") {
    const subject = "Your ShipASO payment didn't go through";
    const line =
      "Your ShipASO payment didn't go through — update your card to keep Autopilot running.";
    const text = `${line}\n\nUpdate your card: ${dashboardUrl}`;
    const html =
      `<p>${line}</p>` +
      `<p><a href="${dashboardUrl}">Update your card</a></p>`;
    return { subject, html, text };
  }
  // recovered
  const subject = "You're all set — Autopilot is running again";
  const line = "You're all set — Autopilot is running again.";
  const text = `${line}\n\nManage billing: ${dashboardUrl}`;
  const html =
    `<p>${line}</p>` + `<p><a href="${dashboardUrl}">Manage billing</a></p>`;
  return { subject, html, text };
}

// ── Checkout Session creation (Stripe REST via fetch) ─────────────────────────────

export type CreateCheckoutArgs = {
  secretKey: string;
  tier: Tier;
  prices: StripePriceEnv;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** our user id — echoed back on the completed event so the webhook can map it. */
  clientReferenceId: string;
};

/**
 * Create a Stripe Checkout Session (test mode) and return its hosted `url`.
 * `fetchFn` is injected so tests mock it; production passes the global `fetch`.
 */
export async function createCheckoutSession(
  fetchFn: typeof fetch,
  args: CreateCheckoutArgs,
): Promise<{ id: string | undefined; url: string }> {
  const { priceId, mode } = stripeCheckoutParams(args.tier, args.prices);

  const form = new URLSearchParams();
  form.set("mode", mode);
  form.set("success_url", args.successUrl);
  form.set("cancel_url", args.cancelUrl);
  form.set("client_reference_id", args.clientReferenceId);
  form.set("customer_email", args.customerEmail);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  // Render the "Add promotion code" field. Stripe defaults this to false, so a
  // promotion code created in the dashboard/API is silently unredeemable — the
  // buyer is never offered anywhere to type it. Mutually exclusive with
  // `discounts` (Stripe rejects a session carrying both), which we never send:
  // a code the customer enters is the only discount path.
  form.set("allow_promotion_codes", "true");

  const resp = await fetchFn(STRIPE_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Idempotency: a retried checkout (network blip, double-click) for the same
      // user+tier reuses the existing session instead of creating a duplicate.
      "Idempotency-Key": `checkout:${args.clientReferenceId}:${args.tier}`,
    },
    body: form.toString(),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`stripe checkout failed (${resp.status}): ${detail}`);
  }
  const session = (await resp.json()) as { id?: string; url?: string };
  if (!session.url) throw new Error("stripe checkout session returned no url");
  return { id: session.id, url: session.url };
}

// ── Webhook signature verification (Web Crypto HMAC, constant-time) ───────────────

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute Stripe's `v1` signature: HMAC-SHA256(`${timestamp}.${body}`), hex. */
export function signStripePayload(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return hmacHex(secret, `${timestamp}.${body}`);
}

/**
 * Verify a `Stripe-Signature` header against the RAW request body. Header shape:
 *   t=<unix>,v1=<hex>[,v1=<hex>...]
 * We recompute HMAC over `${t}.${body}`, constant-time compare against each v1,
 * and reject timestamps outside the tolerance window (replay protection).
 */
export async function verifyStripeSignature(
  secret: string,
  header: string | null,
  body: string,
  opts: { now?: number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "t") timestamp = Number(v);
    else if (k === "v1") v1.push(v);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || v1.length === 0) return false;

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = await signStripePayload(secret, timestamp, body);
  return v1.some((candidate) => constantTimeEqual(candidate, expected));
}
