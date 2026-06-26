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
import { handleDailySnapshot } from "./cron/snapshot.js";

/** The daily snapshot cron expression (wrangler.toml). Branch target in scheduled(). */
const DAILY_SNAPSHOT_CRON = "0 8 * * *";

export type Env = {
  DB: D1Database;
  DEFAULT_COUNTRY: string;
  APP_ENV: string;
  // Workers AI binding (#57) — powers the keyword-reasoning step. OPTIONAL: when
  // unset (local dev / not provisioned) the run derives keywords with the
  // deterministic classifier instead. A missing binding NEVER breaks a run.
  AI?: Ai;
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
  // All paid tiers are recurring subscriptions (mode=subscription).
  STRIPE_PRICE_INDIE?: string; // $7/mo
  STRIPE_PRICE_STARTUP?: string; // $19/mo
  STRIPE_PRICE_SCALE?: string; // $65/mo
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
  // GitHub App (the metadata-PR path, #8). The App id + its private key (PKCS#8
  // PEM) are ShipASO's own credential. Unset → the /github/pr endpoint is inert.
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  // RLHF capture of proposal edits (#39 Part 2). OPTIONAL: when unset, the edit
  // capture is a SILENT no-op — no `proposal_edits` row is written and approval
  // proceeds normally (exactly like the AI reasoner degrades without env.AI). When
  // set, it must be a base64-encoded 32-byte key; proposal-edit values are
  // AES-256-GCM encrypted at rest under it. Rows are anonymous (no user/app id).
  RLHF_ENCRYPTION_KEY?: string;
  // Owner gate for GET /admin/preference-data (the decrypt → JSONL export). When
  // unset, the export route degrades CLOSED (403). Passed as the `x-rlhf-export`
  // request header; must match exactly.
  RLHF_EXPORT_TOKEN?: string;
};

export default {
  /** HTTP API — dashboard + connect-app flow. */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleApi(request, env);
  },

  /**
   * Two cron triggers (#94), dispatched on `event.cron`:
   *   "0 8 * * *" (daily 08:00 UTC) → the lightweight rank SNAPSHOT (snapshot-only,
   *                                   never opens an approval run, never pushes).
   *   "0 9 * * 1" (Mon 09:00 UTC)   → the weekly autonomous sweep (unchanged).
   * Any other/unknown expression falls back to the weekly sweep — the SAFE default
   * (it never runs the snapshot-only path by accident, and never auto-pushes).
   */
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (event.cron === DAILY_SNAPSHOT_CRON) {
      ctx.waitUntil(handleDailySnapshot(env));
      return;
    }
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
