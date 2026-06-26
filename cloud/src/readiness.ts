/**
 * Production-readiness audit — a PURE inspection of the Worker's `Env` that
 * answers "is this deployment safe to put real users in front of?". No DB and
 * no network: it reads only the env fields (secrets + config bindings) and
 * reports which production prerequisites are satisfied.
 *
 * The headline risk is `APP_ENV === "demo"`, which turns on the `X-User-Email`
 * auth stub and an insecure SESSION_SECRET fallback — i.e. anyone can act as
 * anyone. That, plus a missing/weak SESSION_SECRET in a non-demo env, are the
 * only `error`-severity failures (they flip `ready` to false). Everything else
 * (Stripe billing, TinyFish egress, Resend email, the dashboard origin /
 * cookie-domain pairing) is `warn`: the deployment still boots, but a feature
 * is silently degraded.
 *
 * Pure + deterministic so the endpoint that surfaces this (wired separately)
 * just calls `auditReadiness(env)` and serializes the report. Checks are
 * emitted in a fixed order so the output diffs cleanly.
 */
import type { Env } from "./index.js";

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  severity: "error" | "warn";
  detail: string;
};

export type ReadinessReport = {
  /** True iff no `error`-severity check failed. `warn` failures don't block. */
  ready: boolean;
  checks: ReadinessCheck[];
};

const MIN_SESSION_SECRET_LENGTH = 16;

/** True for a real, externally-reachable https dashboard origin. */
function isHttpsOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Audit the env for production readiness. PURE: reads only `env` fields, never
 * touches the DB or network. Checks are returned in a deterministic order;
 * `ready` is true unless some `error`-severity check failed.
 */
export function auditReadiness(env: Env): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  const isDemo = env.APP_ENV === "demo";

  // ── errors: auth integrity ────────────────────────────────────────────────
  checks.push({
    name: "app_env_not_demo",
    ok: !isDemo,
    severity: "error",
    detail: isDemo
      ? 'APP_ENV is "demo": the X-User-Email auth stub is enabled — any caller can impersonate any user.'
      : `APP_ENV is "${env.APP_ENV}": the auth stub is disabled.`,
  });

  const sessionSecretOk =
    isSet(env.SESSION_SECRET) &&
    (env.SESSION_SECRET as string).length >= MIN_SESSION_SECRET_LENGTH;
  checks.push({
    name: "session_secret",
    ok: sessionSecretOk,
    // In demo, a missing SESSION_SECRET is tolerated via the insecure fallback,
    // so it's only an error in a non-demo (production) env.
    severity: isDemo ? "warn" : "error",
    detail: sessionSecretOk
      ? `SESSION_SECRET is set (>= ${MIN_SESSION_SECRET_LENGTH} chars).`
      : `SESSION_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} chars to sign session tokens.`,
  });

  // ── warns: billing (Stripe) ───────────────────────────────────────────────
  const stripeKeySet = isSet(env.STRIPE_SECRET_KEY) || isSet(env.STRIPE_TEST_KEY);
  checks.push({
    name: "stripe_secret_key",
    ok: stripeKeySet,
    severity: "warn",
    detail: stripeKeySet
      ? "STRIPE_SECRET_KEY is set."
      : "STRIPE_SECRET_KEY is missing — Checkout/billing calls will fail.",
  });

  checks.push({
    name: "stripe_webhook_secret",
    ok: isSet(env.STRIPE_WEBHOOK_SECRET),
    severity: "warn",
    detail: isSet(env.STRIPE_WEBHOOK_SECRET)
      ? "STRIPE_WEBHOOK_SECRET is set."
      : "STRIPE_WEBHOOK_SECRET is missing — /billing/webhook signatures can't be verified.",
  });

  const missingPrices = (
    [
      ["STRIPE_PRICE_INDIE", env.STRIPE_PRICE_INDIE],
      ["STRIPE_PRICE_STARTUP", env.STRIPE_PRICE_STARTUP],
      ["STRIPE_PRICE_SCALE", env.STRIPE_PRICE_SCALE],
    ] as const
  )
    .filter(([, value]) => !isSet(value))
    .map(([name]) => name);
  checks.push({
    name: "stripe_prices",
    ok: missingPrices.length === 0,
    severity: "warn",
    detail:
      missingPrices.length === 0
        ? "All Stripe price ids (indie, startup, scale) are set."
        : `Missing Stripe price id(s): ${missingPrices.join(", ")} — those tiers can't be purchased.`,
  });

  // ── warns: egress (TinyFish) ──────────────────────────────────────────────
  checks.push({
    name: "tinyfish_api_key",
    ok: isSet(env.TINYFISH_API_KEY),
    severity: "warn",
    detail: isSet(env.TINYFISH_API_KEY)
      ? "TINYFISH_API_KEY is set — iTunes calls route through clean egress."
      : "TINYFISH_API_KEY is missing — Apple will 403 the datacenter egress in production.",
  });

  // ── warns: email delivery (Brevo preferred, Resend fallback) ──────────────
  const brevoOk = isSet(env.BREVO_API_KEY) && isSet(env.BREVO_FROM);
  const resendOk = isSet(env.RESEND_API_KEY) && isSet(env.RESEND_FROM);
  const emailOk = brevoOk || resendOk;
  const provider = brevoOk ? "Brevo" : resendOk ? "Resend" : null;
  checks.push({
    name: "email_delivery",
    ok: emailOk,
    severity: "warn",
    detail: emailOk
      ? `Magic-link emails are delivered via ${provider}.`
      : "No email provider set (BREVO_API_KEY/BREVO_FROM or RESEND_*) — magic-link emails are only logged, not delivered.",
  });

  // ── warns: dashboard origin + cookie domain ───────────────────────────────
  checks.push({
    name: "dashboard_origin",
    ok: isSet(env.DASHBOARD_ORIGIN),
    severity: "warn",
    detail: isSet(env.DASHBOARD_ORIGIN)
      ? `DASHBOARD_ORIGIN is set (${env.DASHBOARD_ORIGIN}).`
      : "DASHBOARD_ORIGIN is missing — magic-link callbacks/CORS fall back to the request Origin.",
  });

  // COOKIE_DOMAIN only matters once the dashboard lives on a real https origin
  // (the split-subdomain case); skip the requirement for local/dev origins.
  const needsCookieDomain = isHttpsOrigin(env.DASHBOARD_ORIGIN);
  const cookieDomainOk = !needsCookieDomain || isSet(env.COOKIE_DOMAIN);
  checks.push({
    name: "cookie_domain",
    ok: cookieDomainOk,
    severity: "warn",
    detail: cookieDomainOk
      ? needsCookieDomain
        ? `COOKIE_DOMAIN is set (${env.COOKIE_DOMAIN}) for the https dashboard origin.`
        : "COOKIE_DOMAIN not required (no https dashboard origin configured)."
      : "COOKIE_DOMAIN is missing — split-domain sessions across api/app subdomains won't share the cookie.",
  });

  const ready = !checks.some((c) => c.severity === "error" && !c.ok);
  return { ready, checks };
}
