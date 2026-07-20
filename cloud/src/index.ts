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
  // Public base URL of THIS API worker (e.g. "https://api.shipaso.com") — needed
  // by the cron to build absolute unsubscribe links (comms-prefs Phase 2): the
  // cron has no request to derive an origin from, and DASHBOARD_ORIGIN is the
  // Pages frontend which does not serve API routes. Unset → digests send WITHOUT
  // the unsubscribe footer/headers (degrade + warn, never a broken link).
  API_ORIGIN?: string;
  // When the dashboard (app.shipaso.com) and API (api.shipaso.com) live on
  // sibling subdomains, set COOKIE_DOMAIN=".shipaso.com" so the session cookie is
  // shared across them and uses SameSite=None (sent on cross-site fetch). Unset →
  // SameSite=Lax, host-only cookie (single-origin / local dev).
  COOKIE_DOMAIN?: string;
  /**
   * Optional web/Pages origin (e.g. "https://shipaso.com") the magic-link email
   * points at, so the link is a UNIVERSAL LINK that opens the mobile app (via the
   * .well-known association files) and falls back to /auth/m for web. Unset ⇒ the
   * link stays the worker's /auth/callback (today's web-only flow).
   */
  MAGIC_LINK_BASE?: string;
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
  // Opt-in gate for creating the ASC Analytics Reports request (Phase 1). Unset →
  // the /apps/:id/analytics/enable write returns 403 (the read-only status probe
  // stays available). Creating an ONGOING report request is an outward write to
  // the user's Apple account, so it stays dark until deliberately enabled.
  ANALYTICS_ENABLED?: string;
  // Opt-in gate for the CPP "identical to the default page" wasted-surface check
  // (#154). Unset → the per-CPP screenshot signature walk (a 4-hop-per-CPP ASC
  // read) is skipped on every keyed run, so it costs nothing and the finding
  // stays silent. Enable only after validating the CPP-screenshot endpoint paths
  // against a live key (the reader is flagged NEEDS-LIVE-VALIDATION).
  CPP_SHOT_DIFF_ENABLED?: string;
  // Opt-in gate for the first-screenshot caption lens (#182). Unset → the run
  // attaches NO caption finding (the vision OCR never fires). Set to "1"/"true"
  // to enable: each keyed/keyless run then OCRs the primary screenshot's headline
  // via the Workers AI vision model (env.AI) and flags a feature-led caption.
  // Costs one vision inference per run and reads the user's screenshot, so it
  // stays dark until deliberately switched on.
  CAPTION_OCR_ENABLED?: string;
  // Opt-in gate for the broad category rank+metadata corpus (#63) — the
  // compounding data moat. Unset → the daily cron collects NO corpus (default);
  // set to "1"/"true" to enable collecting the top-N apps per fixed seed keyword.
  // OFF by default because broad systematic iTunes collection is a different
  // egress/ToS scale than the product's per-app reads — enable only after the
  // owner has reviewed acceptable-use + cost. Capped small (seeds × topN).
  CATEGORY_CORPUS_ENABLED?: string;
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
  // Owner gate for POST/GET /broadcast/* (owner-only launch/newsletter send to
  // the subscriber list). Passed as the `x-broadcast-token` request header; must
  // match exactly. Unset → the broadcast routes degrade CLOSED (403).
  BROADCAST_TOKEN?: string;
  // #67 post-launch half: the key-encryption key (KEK) for OPT-IN stored store
  // credentials (envelope encryption; design in docs/prd/credential-storage/).
  // base64-encoded 32 bytes. Unset → the store-credential feature is honestly
  // UNAVAILABLE (the opt-in UI hides, the routes 503) — the per-run ephemeral
  // path is unaffected. Rotation adds CRED_KEK_V2 etc. (lazy re-wrap on use).
  CRED_KEK_V1?: string;
  CRED_KEK_V2?: string;
  // #78-2: gate for SURFACING Apple Search Ads popularity in scoring/UI. Connect
  // + store + verify of an ASA key works whenever credential storage is enabled
  // (a KEK is set); but the popularity NUMBERS stay dark until this is set to
  // "1"/"true" — flip it only after verifying the v5 popularity read against a
  // live ASA account (owner action, per docs/prd/localization/asa-data-spike.md).
  ASA_POPULARITY_ENABLED?: string;
  // Gate for the Android vitals read on the owner Play audit. Off by default;
  // flip it only after confirming the Play Developer Reporting query shape
  // against a live account (owner action). The vitals FINDING logic is exact +
  // tested; the live read is dark until verified. Degrade-safe when off/failing.
  PLAY_VITALS_ENABLED?: string;
  // Play keyword SEARCH-rank scrape (ranking-parity step 2). Off by default: the
  // search page 429s from Worker egress and Play personalizes results, so the
  // read is dark until we accept the reliability/ToS cost. Degrade-safe when off.
  PLAY_SEARCH_RANK_ENABLED?: string;
  // Play data-safety WRITE (PRD 02-B) — the first Play fix-and-push, on a LEGAL
  // declaration. Off by default: the route 403s unless enabled, and even then the
  // pushed CSV is the human's own (validated, never generated). Dark until enabled.
  PLAY_DATA_SAFETY_WRITE_ENABLED?: string;
  // Play conversion-funnel ingest (PRD 02-D) — the monthly GCS export. Off by
  // default: the export object naming is best-effort, so the ingest route 403s
  // until enabled. The READ route is always available (serves persisted data).
  PLAY_FUNNEL_ENABLED?: string;
};

export default {
  /** HTTP API — dashboard + connect-app flow. */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleApi(request, env, ctx);
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
