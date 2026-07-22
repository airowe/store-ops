/**
 * ASC webhook receiver. Verifies the signature, dedups the delivery, debounces
 * per-app bursts, and on the fresh path schedules the SAME keyed sweep the cron
 * runs — via ctx.waitUntil so Apple gets a fast 2xx. NEVER pushes.
 *
 * Deps are injected so the whole handler unit-tests without D1/network.
 */
import type { AppRow } from "../d1.js";
import type { Env } from "../index.js";
import { parseWebhookEvent, verifyDelivery } from "../engine/ascWebhookVerify.js";

/** Apple's signature header. CONFIRM the exact name/encoding against Apple's
 *  webhook delivery docs at implementation; hex HMAC-SHA256 assumed. */
export const SIGNATURE_HEADER = "x-apple-signature";
const DEBOUNCE_WINDOW_SECONDS = 300;

/**
 * Extract JUST the ASC app id from a raw body, tolerating garbage. This is
 * intentionally more lenient than `parseWebhookEvent` — it needs only enough
 * structure to know which app's secret to verify against, NOT a fully valid
 * event. Without this split, a body with a resolvable app id but some other
 * malformed/missing field would 401 (unattributable) instead of the more
 * honest 400 (authentic sender, malformed payload) once verified — the two
 * failure modes are genuinely different for an operator debugging deliveries.
 */
function peekAscAppId(rawBody: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const data = (obj as { data?: unknown }).data as Record<string, unknown> | undefined;
  if (!data) return null;
  const rels = (data.relationships ?? {}) as Record<string, unknown>;
  const appData = ((rels.app as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;
  const ascAppId = appData.id;
  return typeof ascAppId === "string" && ascAppId.length > 0 ? ascAppId : null;
}

export type WebhookDeps = {
  resolveAppAndSecret: (env: Env, ascAppId: string) => Promise<{ app: AppRow; secret: string } | null>;
  runKeyedSweepForApp: (env: Env, app: AppRow) => Promise<string | null>;
  enqueue: (env: Env, args: { deliveryId: string; ascAppId: string; eventType: string; at: string }) => Promise<{ fresh: boolean }>;
  shouldDebounce: (env: Env, ascAppId: string, windowSeconds: number, now: number) => Promise<boolean>;
  markSwept: (env: Env, ascAppId: string, at: string) => Promise<void>;
  now: () => number; // unix seconds
};

export async function handleWebhookReceive(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: WebhookDeps,
): Promise<Response> {
  const rawBody = await req.text();
  const sigHeader = req.headers.get(SIGNATURE_HEADER) ?? "";

  // Peek ONLY the app id to learn which secret to verify against; nothing
  // else from the body is trusted until the signature checks out. A body we
  // can't even attribute to an app is indistinguishable from an attacker
  // probing with garbage — unauthorized, not malformed.
  const ascAppId = peekAscAppId(rawBody);
  if (!ascAppId) {
    return new Response("unauthorized", { status: 401 });
  }

  const resolved = await deps.resolveAppAndSecret(env, ascAppId);
  if (!resolved) return new Response("unauthorized", { status: 401 });

  const ok = await verifyDelivery(resolved.secret, rawBody, sigHeader);
  if (!ok) return new Response("unauthorized", { status: 401 });

  // Verified. Now a parse failure is a genuine malformed-but-authentic body.
  const event = parseWebhookEvent(rawBody);
  if (!event) return new Response("bad request", { status: 400 });

  const nowSec = deps.now();
  const at = new Date(nowSec * 1000).toISOString();

  const { fresh } = await deps.enqueue(env, {
    deliveryId: event.deliveryId, ascAppId: event.ascAppId, eventType: event.eventType, at,
  });
  if (!fresh) return new Response("ok (duplicate)", { status: 200 });

  if (await deps.shouldDebounce(env, event.ascAppId, DEBOUNCE_WINDOW_SECONDS, nowSec)) {
    return new Response("ok (coalesced)", { status: 200 });
  }

  // Fresh + not debounced → schedule the sweep off the response path.
  ctx.waitUntil(
    (async () => {
      await deps.markSwept(env, event.ascAppId, at);
      try {
        await deps.runKeyedSweepForApp(env, resolved.app);
      } catch {
        // The delivery WAS received (we already 200'd). A sweep failure is
        // covered by the cron heartbeat on its next pass — never surface it here.
      }
    })(),
  );
  return new Response("ok", { status: 200 });
}
