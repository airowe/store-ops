/**
 * Tests for the PURE production-readiness audit. Each test builds an `Env`
 * fixture inline (only the fields the audit reads matter), then asserts on the
 * `ready` flag and on individual named checks. The two `error`-severity checks
 * (the demo auth stub + a weak/missing SESSION_SECRET in prod) are the only
 * ones that can flip `ready` to false; everything else is `warn`.
 */
import { describe, expect, it } from "vitest";
import { auditReadiness, type ReadinessCheck } from "./readiness.js";
import type { Env } from "./index.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

/**
 * Override map for the fixture. Each Env field is optional AND may be explicitly
 * `undefined` — under `exactOptionalPropertyTypes` that's how a test says "unset
 * this secret" (plain `Partial<Env>` would reject the `undefined`).
 */
type EnvOverrides = { [K in keyof Env]?: Env[K] | undefined };

/** A fully-configured production env: every check should pass. */
function prodEnv(over: EnvOverrides = {}): Env {
  return {
    DB: {} as D1Database,
    DEFAULT_COUNTRY: "us",
    APP_ENV: "production",
    DASHBOARD_ORIGIN: "https://app.shipaso.com",
    COOKIE_DOMAIN: ".shipaso.com",
    SESSION_SECRET: "a-32-char-long-session-secret!!",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_123",
    STRIPE_PRICE_LAUNCH: "price_launch",
    STRIPE_PRICE_AUTOPILOT: "price_autopilot",
    STRIPE_PRICE_FLEET: "price_fleet",
    TINYFISH_API_KEY: "tf_123",
    RESEND_API_KEY: "re_123",
    RESEND_FROM: "store-ops <login@mail.shipaso.com>",
    ...over,
    // `over` may carry explicit `undefined` for optional secrets (that's the
    // point); the cast keeps the required base fields' types intact.
  } as Env;
}

/** Find a check by name; fail loudly if the audit stopped emitting it. */
function check(report: { checks: ReadinessCheck[] }, name: string): ReadinessCheck {
  const found = report.checks.find((c) => c.name === name);
  if (!found) throw new Error(`no check named "${name}" in report`);
  return found;
}

const errorFailures = (report: { checks: ReadinessCheck[] }): ReadinessCheck[] =>
  report.checks.filter((c) => c.severity === "error" && !c.ok);

const warnFailures = (report: { checks: ReadinessCheck[] }): ReadinessCheck[] =>
  report.checks.filter((c) => c.severity === "warn" && !c.ok);

// ── fully-configured prod ─────────────────────────────────────────────────────

describe("auditReadiness — fully configured production env", () => {
  it("is ready with no failing checks of any severity", () => {
    const report = auditReadiness(prodEnv());
    expect(report.ready).toBe(true);
    expect(errorFailures(report)).toHaveLength(0);
    expect(warnFailures(report)).toHaveLength(0);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it("emits its checks in a deterministic order", () => {
    const a = auditReadiness(prodEnv()).checks.map((c) => c.name);
    const b = auditReadiness(prodEnv()).checks.map((c) => c.name);
    expect(a).toStrictEqual(b);
    // every check is uniquely named
    expect(new Set(a).size).toBe(a.length);
  });
});

// ── demo env: the auth-stub error ─────────────────────────────────────────────

describe('auditReadiness — APP_ENV "demo"', () => {
  it("flags an error check for the enabled auth stub and is not ready", () => {
    const report = auditReadiness(prodEnv({ APP_ENV: "demo" }));
    expect(report.ready).toBe(false);

    const stub = check(report, "app_env_not_demo");
    expect(stub.ok).toBe(false);
    expect(stub.severity).toBe("error");
    expect(errorFailures(report)).toContainEqual(stub);
  });

  it("does not treat a missing SESSION_SECRET as an error in demo (insecure fallback)", () => {
    const report = auditReadiness(prodEnv({ APP_ENV: "demo", SESSION_SECRET: undefined }));
    const secret = check(report, "session_secret");
    expect(secret.ok).toBe(false);
    expect(secret.severity).toBe("warn");
    // the ONLY error in demo is the auth stub, not the secret
    expect(errorFailures(report).map((c) => c.name)).toStrictEqual(["app_env_not_demo"]);
  });
});

// ── prod SESSION_SECRET errors ────────────────────────────────────────────────

describe("auditReadiness — SESSION_SECRET in production", () => {
  it("is an error and blocks readiness when missing", () => {
    const report = auditReadiness(prodEnv({ SESSION_SECRET: undefined }));
    const secret = check(report, "session_secret");
    expect(secret.ok).toBe(false);
    expect(secret.severity).toBe("error");
    expect(report.ready).toBe(false);
  });

  it.each([0, 1, 8, 15])("is an error when shorter than 16 chars (len %i)", (len) => {
    const report = auditReadiness(prodEnv({ SESSION_SECRET: "x".repeat(len) }));
    const secret = check(report, "session_secret");
    expect(secret.ok).toBe(false);
    expect(secret.severity).toBe("error");
    expect(report.ready).toBe(false);
  });

  it.each([16, 17, 64])("passes at length >= 16 (len %i)", (len) => {
    const report = auditReadiness(prodEnv({ SESSION_SECRET: "x".repeat(len) }));
    expect(check(report, "session_secret").ok).toBe(true);
    expect(report.ready).toBe(true);
  });
});

// ── warn-only prod: ready but degraded ────────────────────────────────────────

describe("auditReadiness — prod missing only warn-level config", () => {
  it("stays ready while surfacing warn checks for each missing integration", () => {
    const report = auditReadiness(
      prodEnv({
        STRIPE_SECRET_KEY: undefined,
        STRIPE_TEST_KEY: undefined,
        STRIPE_WEBHOOK_SECRET: undefined,
        STRIPE_PRICE_AUTOPILOT: undefined,
        TINYFISH_API_KEY: undefined,
        RESEND_API_KEY: undefined,
        RESEND_FROM: undefined,
        DASHBOARD_ORIGIN: undefined,
      }),
    );

    // no error-level failures → still shippable
    expect(errorFailures(report)).toHaveLength(0);
    expect(report.ready).toBe(true);

    // but the degraded integrations are reported as warn failures
    const failedWarn = warnFailures(report).map((c) => c.name);
    expect(failedWarn).toEqual(
      expect.arrayContaining([
        "stripe_secret_key",
        "stripe_webhook_secret",
        "stripe_prices",
        "tinyfish_api_key",
        "resend_email",
        "dashboard_origin",
      ]),
    );
    expect(warnFailures(report).every((c) => c.severity === "warn")).toBe(true);
  });
});

// ── individual warn checks ────────────────────────────────────────────────────

describe("auditReadiness — Stripe price completeness", () => {
  it("warns when any single price id is missing", () => {
    const report = auditReadiness(prodEnv({ STRIPE_PRICE_FLEET: undefined }));
    const prices = check(report, "stripe_prices");
    expect(prices.ok).toBe(false);
    expect(prices.severity).toBe("warn");
    expect(prices.detail).toContain("STRIPE_PRICE_FLEET");
  });

  it("passes only when all three price ids are present", () => {
    expect(check(auditReadiness(prodEnv()), "stripe_prices").ok).toBe(true);
  });
});

describe("auditReadiness — Stripe secret key (rename migration #9)", () => {
  it("passes on the new STRIPE_SECRET_KEY name", () => {
    const report = auditReadiness(prodEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_TEST_KEY: undefined }));
    expect(check(report, "stripe_secret_key").ok).toBe(true);
  });

  it("still passes on the legacy STRIPE_TEST_KEY (fallback during migration)", () => {
    const report = auditReadiness(prodEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_TEST_KEY: "sk_test_legacy" }));
    expect(check(report, "stripe_secret_key").ok).toBe(true);
  });

  it("fails (warn) when neither name is set", () => {
    const report = auditReadiness(prodEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_TEST_KEY: undefined }));
    const c = check(report, "stripe_secret_key");
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
  });
});

describe("auditReadiness — Resend pairing", () => {
  it.each([
    ["RESEND_API_KEY", { RESEND_API_KEY: undefined } as EnvOverrides],
    ["RESEND_FROM", { RESEND_FROM: undefined } as EnvOverrides],
  ])("warns when %s alone is missing", (_label, over) => {
    expect(check(auditReadiness(prodEnv(over)), "resend_email").ok).toBe(false);
  });
});

describe("auditReadiness — cookie domain vs dashboard origin", () => {
  it("requires COOKIE_DOMAIN once DASHBOARD_ORIGIN is a real https origin", () => {
    const report = auditReadiness(
      prodEnv({ DASHBOARD_ORIGIN: "https://app.shipaso.com", COOKIE_DOMAIN: undefined }),
    );
    const cookie = check(report, "cookie_domain");
    expect(cookie.ok).toBe(false);
    expect(cookie.severity).toBe("warn");
    expect(report.ready).toBe(true); // warn, never blocks
  });

  it("does not require COOKIE_DOMAIN for a non-https (local/dev) origin", () => {
    const report = auditReadiness(
      prodEnv({ DASHBOARD_ORIGIN: "http://localhost:5173", COOKIE_DOMAIN: undefined }),
    );
    expect(check(report, "cookie_domain").ok).toBe(true);
  });

  it("does not require COOKIE_DOMAIN when DASHBOARD_ORIGIN is unset", () => {
    const report = auditReadiness(
      prodEnv({ DASHBOARD_ORIGIN: undefined, COOKIE_DOMAIN: undefined }),
    );
    expect(check(report, "cookie_domain").ok).toBe(true);
  });

  it("is satisfied when both the https origin and the cookie domain are set", () => {
    expect(check(auditReadiness(prodEnv()), "cookie_domain").ok).toBe(true);
  });
});
