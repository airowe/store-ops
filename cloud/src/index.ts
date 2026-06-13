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
  // Secrets (set via `wrangler secret put`):
  SESSION_SECRET?: string; // signs magic-link + session tokens (HMAC-SHA256)
  STRIPE_TEST_KEY?: string; // Stripe test-mode secret key (Bearer for the REST API)
  STRIPE_WEBHOOK_SECRET?: string; // verifies the Stripe-Signature on /billing/webhook
  // Stripe Price ids per tier (test mode). tier → price lookup for Checkout.
  STRIPE_PRICE_LAUNCH?: string; // $49 one-time (mode=payment)
  STRIPE_PRICE_AUTOPILOT?: string; // $19/mo (mode=subscription)
  STRIPE_PRICE_FLEET?: string; // $149/mo (mode=subscription)
  // When set, iTunes calls route through TinyFish Fetch (clean egress) to dodge
  // Apple's 403 on Cloudflare datacenter IPs. Unset → direct fetch (local/dev).
  TINYFISH_API_KEY?: string;
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
