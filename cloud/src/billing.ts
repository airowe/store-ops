/**
 * Stripe billing + tier gates.
 *
 * No Stripe SDK — it's heavy for Workers. We call the Stripe REST API directly
 * with `fetch` (the secret key as a Bearer), and verify webhooks with Web Crypto
 * HMAC-SHA256 (the same primitive auth.ts uses), constant-time. Everything here
 * is pure or fetch-injected so it tests without the real Stripe API or a DB.
 *
 * Tiers (see commercial/OFFER.md):
 *   free      — run-it-yourself; manual runs only, 1 app, NO cron autonomy
 *   launch    — $49 one-time optimization pass; 1 app, still no standing autonomy
 *   autopilot — $19/mo; weekly cron autonomy, small fleet
 *   fleet     — $149/mo; portfolio across many apps
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
    case "launch":
      return 1; // one-time optimization pass, single app
    case "autopilot":
      return 3;
    case "fleet":
      return 50;
  }
}

/** Only the recurring tiers get the weekly autonomous sweep. */
export function canRunCron(tier: Tier): boolean {
  return tier === "autopilot" || tier === "fleet";
}

// ── tier ⇄ Stripe price mapping ───────────────────────────────────────────────────

export type StripePriceEnv = {
  STRIPE_PRICE_LAUNCH?: string;
  STRIPE_PRICE_AUTOPILOT?: string;
  STRIPE_PRICE_FLEET?: string;
};

type PaidTier = Exclude<Tier, "free">;
type CheckoutMode = "payment" | "subscription";

/** Static per-tier checkout shape: which env price + which Stripe mode. */
const TIER_CONFIG: Record<PaidTier, { envKey: keyof StripePriceEnv; mode: CheckoutMode }> = {
  launch: { envKey: "STRIPE_PRICE_LAUNCH", mode: "payment" }, // $49 one-time
  autopilot: { envKey: "STRIPE_PRICE_AUTOPILOT", mode: "subscription" }, // $19/mo
  fleet: { envKey: "STRIPE_PRICE_FLEET", mode: "subscription" }, // $149/mo
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
  if (priceId && priceId === prices.STRIPE_PRICE_LAUNCH) return "launch";
  if (priceId && priceId === prices.STRIPE_PRICE_AUTOPILOT) return "autopilot";
  if (priceId && priceId === prices.STRIPE_PRICE_FLEET) return "fleet";
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

  const resp = await fetchFn(STRIPE_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
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
