/**
 * store-ops Worker entry point.
 *
 * Wires the three plug points:
 *   - fetch()      → src/api/      (the REST API the dashboard calls)
 *   - scheduled()  → src/cron/     (the weekly autonomy loop)
 *   - engine logic → src/engine/   (ported ASO loop: audit/rank/competitor/copy)
 *
 * The Worker holds the only Cloudflare bindings (env.DB). Engine code stays pure;
 * the API/cron layers pass the global `fetch` into it.
 */
import { handleApi } from "./api/index.js";
import { handleScheduled } from "./cron/scheduled.js";

export type Env = {
  DB: D1Database;
  DEFAULT_COUNTRY: string;
  APP_ENV: string;
  // Public base URL of the dashboard (for magic-link callback + CORS origin echo).
  // Optional: falls back to the request Origin when unset.
  DASHBOARD_ORIGIN?: string;
  // When the dashboard (app.shipaso.com) and API (api.shipaso.com) live on
  // sibling subdomains, set COOKIE_DOMAIN=".shipaso.com" so the session cookie is
  // shared across them and uses SameSite=None (sent on cross-site fetch). Unset →
  // SameSite=Lax, host-only cookie (single-origin / local dev).
  COOKIE_DOMAIN?: string;
  // Secrets (set via `wrangler secret put`):
  SESSION_SECRET?: string; // signs magic-link + session tokens (HMAC-SHA256)
  STRIPE_SECRET_KEY?: string; // Stripe secret key (Bearer for the REST API) — test OR live
  STRIPE_TEST_KEY?: string; // deprecated alias for STRIPE_SECRET_KEY; read as a fallback during migration
  STRIPE_WEBHOOK_SECRET?: string; // verifies the Stripe-Signature on /billing/webhook
  // Stripe Price ids per tier (test mode). tier → price lookup for Checkout.
  STRIPE_PRICE_LAUNCH?: string; // $49 one-time (mode=payment)
  STRIPE_PRICE_AUTOPILOT?: string; // $19/mo (mode=subscription)
  STRIPE_PRICE_FLEET?: string; // $149/mo (mode=subscription)
  // When set, iTunes calls route through TinyFish Fetch (clean egress) to dodge
  // Apple's 403 on Cloudflare datacenter IPs. Unset → direct fetch (local/dev).
  TINYFISH_API_KEY?: string;
  // Resend (magic-link email delivery). With RESEND_API_KEY set, /auth/request
  // emails the link via Resend; unset → ConsoleEmailSender (logs the link).
  // Brevo (the configured email provider; preferred over Resend when set).
  BREVO_API_KEY?: string;
  BREVO_FROM?: string; // verified sender, e.g. "ShipASO <login@shipaso.com>"
  RESEND_API_KEY?: string;
  RESEND_FROM?: string; // legacy fallback sender, e.g. "ShipASO <login@mail.yourdomain>"
  // Opt-in gate for the direct ASC metadata WRITE (#11). Unset → the push
  // endpoint returns 403 (the credential-free Fastlane handoff stays the default).
  // Set to "1"/"true" only after verifying against a test app.
  ASC_WRITE_ENABLED?: string;
};

export default {
  /** HTTP API — dashboard + connect-app flow. */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleApi(request, env);
  },

  /** Weekly cron (Mon 09:00 UTC) — the autonomous loop. */
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
