/**
 * POST /billing/revenuecat — the RevenueCat (in-app purchase) webhook, driven
 * through the REAL router. RevenueCat authenticates with a shared secret in the
 * Authorization header (not an HMAC over the body), and `app_user_id` IS our user
 * id (the app calls Purchases.logIn). This asserts the auth gate, the ignore path,
 * and that a valid grant writes the IAP source tier + recomputes the effective one.
 *
 * The tier/status decision itself is unit-tested in billing.spec.ts and the
 * effective-tier reconciliation in d1.revenuecatIap.spec.ts; here the DB boundary
 * is mocked so the test is about the HANDLER glue (auth, dispatch, user lookup).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let knownUser: { id: string; email: string } | null = { id: "user-1", email: "u@e.co" };
const setTier = vi.fn(async (_db: unknown, _args: Record<string, unknown>) => {});
const recomputeEffectiveTier = vi.fn(async (_db: unknown, _userId: string) => "scale" as const);
const getUser = vi.fn(async (_db: unknown, id: string) =>
  knownUser && id === knownUser.id ? knownUser : null,
);

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getUser, setTier, recomputeEffectiveTier };
});

const { handleApi } = await import("./index.js");

const AUTH = "Bearer rc-secret";

const env = {
  APP_ENV: "demo",
  DB: {} as never,
  REVENUECAT_WEBHOOK_AUTH: AUTH,
  REVENUECAT_PRODUCT_INDIE: "rc_indie",
  REVENUECAT_PRODUCT_STARTUP: "rc_startup",
  REVENUECAT_PRODUCT_SCALE: "rc_scale",
} as never;

const post = (body: unknown, headers: Record<string, string> = { Authorization: AUTH }, e = env) =>
  handleApi(
    new Request("https://api.test/billing/revenuecat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    e,
    {} as never,
  );

const purchase = (appUserId = "user-1", productId = "rc_scale") => ({
  event: { type: "INITIAL_PURCHASE", app_user_id: appUserId, product_id: productId },
});

beforeEach(() => {
  knownUser = { id: "user-1", email: "u@e.co" };
  setTier.mockClear();
  recomputeEffectiveTier.mockClear();
  getUser.mockClear();
});

describe("POST /billing/revenuecat", () => {
  it("503s when the webhook auth secret is unset", async () => {
    const res = await post(purchase(), { Authorization: AUTH }, { APP_ENV: "demo", DB: {} } as never);
    expect(res.status).toBe(503);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("401s a request with no Authorization header, writing nothing", async () => {
    const res = await post(purchase(), {});
    expect(res.status).toBe(401);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("401s a wrong Authorization value, writing nothing", async () => {
    const res = await post(purchase(), { Authorization: "Bearer nope" });
    expect(res.status).toBe(401);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("400s an invalid JSON body (authenticated)", async () => {
    const res = await post("{not json", { Authorization: AUTH });
    expect(res.status).toBe(400);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("applies a valid purchase: writes the IAP source tier + recomputes", async () => {
    const res = await post(purchase("user-1", "rc_scale"));
    expect(res.status).toBe(200);
    expect(setTier).toHaveBeenCalledTimes(1);
    const arg = setTier.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).toMatchObject({ userId: "user-1", iapTier: "scale", iapStatus: "active" });
    expect(recomputeEffectiveTier).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("acknowledges (200) but writes nothing for an unknown app_user_id", async () => {
    const res = await post(purchase("stranger", "rc_scale"));
    expect(res.status).toBe(200);
    expect(setTier).not.toHaveBeenCalled();
    expect(recomputeEffectiveTier).not.toHaveBeenCalled();
  });

  it("acknowledges (200) but writes nothing for an unmappable product", async () => {
    const res = await post(purchase("user-1", "rc_unknown"));
    expect(res.status).toBe(200);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("acknowledges (200) but writes nothing for an ignored event type", async () => {
    const res = await post({ event: { type: "TRANSFER", app_user_id: "user-1" } });
    expect(res.status).toBe(200);
    expect(setTier).not.toHaveBeenCalled();
  });
});
