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
  // Secrets (set via `wrangler secret put`):
  SESSION_SECRET?: string;
  STRIPE_TEST_KEY?: string;
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
