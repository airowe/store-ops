/**
 * Billing logic — tier gates, the tier→Stripe-price/mode mapping, Checkout
 * Session creation (fetch mocked, never the real Stripe API), and the webhook
 * signature verify (valid + tampered). All pure / fetch-injected, no DB.
 */
import { describe, expect, it, vi } from "vitest";
import {
  appLimitForTier,
  canRunCron,
  createCheckoutSession,
  dunningEmail,
  dunningOutcome,
  signStripePayload,
  stripeCheckoutParams,
  tierForPriceId,
  verifyStripeSignature,
  type StripePriceEnv,
} from "./billing.js";

const PRICES: StripePriceEnv = {
  STRIPE_PRICE_LAUNCH: "price_launch",
  STRIPE_PRICE_AUTOPILOT: "price_autopilot",
  STRIPE_PRICE_FLEET: "price_fleet",
};

describe("appLimitForTier", () => {
  it("limits free to a single connected app", () => {
    expect(appLimitForTier("free")).toBe(1);
  });
  it("gives launch a single app (one-time pass, not autonomous)", () => {
    expect(appLimitForTier("launch")).toBe(1);
  });
  it("gives autopilot a small fleet", () => {
    expect(appLimitForTier("autopilot")).toBe(3);
  });
  it("gives fleet a large allowance", () => {
    expect(appLimitForTier("fleet")).toBeGreaterThanOrEqual(25);
  });
});

describe("canRunCron", () => {
  it("excludes free + launch from the autonomous sweep", () => {
    expect(canRunCron("free")).toBe(false);
    expect(canRunCron("launch")).toBe(false);
  });
  it("includes the recurring tiers", () => {
    expect(canRunCron("autopilot")).toBe(true);
    expect(canRunCron("fleet")).toBe(true);
  });
});

describe("stripeCheckoutParams", () => {
  it("maps launch → the launch price in payment mode (one-time)", () => {
    const p = stripeCheckoutParams("launch", PRICES);
    expect(p).toMatchObject({ priceId: "price_launch", mode: "payment" });
  });
  it("maps autopilot → the autopilot price in subscription mode", () => {
    const p = stripeCheckoutParams("autopilot", PRICES);
    expect(p).toMatchObject({ priceId: "price_autopilot", mode: "subscription" });
  });
  it("maps fleet → the fleet price in subscription mode", () => {
    const p = stripeCheckoutParams("fleet", PRICES);
    expect(p).toMatchObject({ priceId: "price_fleet", mode: "subscription" });
  });
  it("rejects 'free' (nothing to buy)", () => {
    expect(() => stripeCheckoutParams("free", PRICES)).toThrow();
  });
  it("throws a clear error when the price env for the tier is unset", () => {
    const noAutopilot: StripePriceEnv = {
      STRIPE_PRICE_LAUNCH: "price_launch",
      STRIPE_PRICE_FLEET: "price_fleet",
    };
    expect(() => stripeCheckoutParams("autopilot", noAutopilot)).toThrow(/STRIPE_PRICE_AUTOPILOT/);
  });
});

describe("tierForPriceId (webhook reverse-map)", () => {
  it("maps each configured price id back to its tier", () => {
    expect(tierForPriceId("price_launch", PRICES)).toBe("launch");
    expect(tierForPriceId("price_autopilot", PRICES)).toBe("autopilot");
    expect(tierForPriceId("price_fleet", PRICES)).toBe("fleet");
  });
  it("returns null for an unknown price id", () => {
    expect(tierForPriceId("price_nope", PRICES)).toBeNull();
  });
});

describe("createCheckoutSession", () => {
  it("POSTs to the Stripe sessions endpoint with the right price, mode + bearer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/c/123" }),
        text: async () => "",
      } as unknown as Response;
    });

    const res = await createCheckoutSession(fetchMock as unknown as typeof fetch, {
      secretKey: "sk_test_abc",
      tier: "autopilot",
      prices: PRICES,
      customerEmail: "buyer@example.com",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/cancel",
      clientReferenceId: "user-1",
    });

    expect(res.url).toBe("https://checkout.stripe.com/c/123");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_abc");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // idempotency: a retried checkout for the same user+tier reuses the session
    // instead of creating a duplicate. Key is derived from those, not random.
    expect(headers["Idempotency-Key"]).toBe("checkout:user-1:autopilot");

    const body = String(call.init.body);
    expect(body).toContain("mode=subscription");
    expect(body).toContain(encodeURIComponent("price_autopilot"));
    expect(body).toContain("line_items%5B0%5D%5Bquantity%5D=1");
    expect(body).toContain("client_reference_id=user-1");
    expect(body).toContain(`customer_email=${encodeURIComponent("buyer@example.com")}`);
  });

  it("uses payment mode for the one-time launch tier", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://checkout/x" }),
      text: async () => "",
    } as unknown as Response));

    await createCheckoutSession(fetchMock as unknown as typeof fetch, {
      secretKey: "sk_test_abc",
      tier: "launch",
      prices: PRICES,
      customerEmail: "buyer@example.com",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/cancel",
      clientReferenceId: "user-1",
    });
    const init = fetchMock.mock.calls[0]![1];
    const body = String(init.body);
    expect(body).toContain("mode=payment");
    expect(body).toContain(encodeURIComponent("price_launch"));
  });

  it("throws when Stripe returns a non-2xx", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "bad" } }),
      text: async () => '{"error":{"message":"bad"}}',
    } as unknown as Response));

    await expect(
      createCheckoutSession(fetchMock as unknown as typeof fetch, {
        secretKey: "sk_test_abc",
        tier: "fleet",
        prices: PRICES,
        customerEmail: "b@e.com",
        successUrl: "https://app/ok",
        cancelUrl: "https://app/cancel",
        clientReferenceId: "u",
      }),
    ).rejects.toThrow();
  });
});

describe("Stripe webhook signature", () => {
  const SECRET = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("verifies a correctly signed payload", async () => {
    const t = 1700000000;
    const sig = await signStripePayload(SECRET, t, body);
    const header = `t=${t},v1=${sig}`;
    const res = await verifyStripeSignature(SECRET, header, body, { now: t + 60 });
    expect(res).toBe(true);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const t = 1700000000;
    const sig = await signStripePayload(SECRET, t, body);
    const header = `t=${t},v1=${sig}`;
    const res = await verifyStripeSignature(SECRET, header, body + "x", { now: t + 60 });
    expect(res).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const t = 1700000000;
    const sig = await signStripePayload(SECRET, t, body);
    const header = `t=${t},v1=${sig}`;
    const res = await verifyStripeSignature("whsec_other", header, body, { now: t + 60 });
    expect(res).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", async () => {
    const t = 1700000000;
    const sig = await signStripePayload(SECRET, t, body);
    const header = `t=${t},v1=${sig}`;
    const res = await verifyStripeSignature(SECRET, header, body, {
      now: t + 60 * 60,
      toleranceSeconds: 300,
    });
    expect(res).toBe(false);
  });

  it("rejects a malformed header", async () => {
    expect(await verifyStripeSignature(SECRET, "garbage", body, { now: 1 })).toBe(false);
    expect(await verifyStripeSignature(SECRET, "", body, { now: 1 })).toBe(false);
  });
});

describe("dunningOutcome (failed-payment recovery, pure)", () => {
  it("flags a failed payment as past_due and queues the past_due nudge", () => {
    expect(dunningOutcome("invoice.payment_failed", "active")).toEqual({
      newStatus: "past_due",
      sendEmail: "past_due",
    });
  });

  it("flags a failed payment as past_due even if already past_due (idempotent re-flag)", () => {
    expect(dunningOutcome("invoice.payment_failed", "past_due")).toEqual({
      newStatus: "past_due",
      sendEmail: "past_due",
    });
  });

  it("recovers a past_due account back to active and queues the recovered email", () => {
    expect(dunningOutcome("invoice.payment_succeeded", "past_due")).toEqual({
      newStatus: "active",
      sendEmail: "recovered",
    });
  });

  it("treats a payment success on an already-active account as a normal renewal no-op", () => {
    expect(dunningOutcome("invoice.payment_succeeded", "active")).toEqual({});
  });

  it("ignores unrelated event types", () => {
    expect(dunningOutcome("customer.subscription.updated", "active")).toEqual({});
    expect(dunningOutcome("checkout.session.completed", "past_due")).toEqual({});
  });
});

describe("dunningEmail (recovery email composer, pure)", () => {
  const dashboardUrl = "https://app.shipaso.com/billing";

  it("composes a past_due nudge with the update-card CTA pointing at the dashboard", () => {
    const email = dunningEmail("past_due", { dashboardUrl });
    expect(email.subject.toLowerCase()).toContain("payment");
    expect(email.text).toContain(dashboardUrl);
    expect(email.html).toContain(dashboardUrl);
    // single CTA — exactly one link to the dashboard
    expect(email.html.match(new RegExp(escapeRegExp(dashboardUrl), "g"))).toHaveLength(1);
  });

  it("composes a recovered confirmation that says Autopilot is running again", () => {
    const email = dunningEmail("recovered", { dashboardUrl });
    expect(email.subject.toLowerCase()).toContain("autopilot");
    expect(email.text.toLowerCase()).toContain("running again");
    expect(email.html.toLowerCase()).toContain("running again");
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
