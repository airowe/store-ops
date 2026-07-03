/**
 * Expo push — build + send notifications via the Expo Push API. Pure message
 * construction (unit-tested) plus a thin sender that takes an injected fetch,
 * exactly like the rest of the engine, so it tests with zero network.
 *
 * The send is BEST-EFFORT: a delivery failure (blocked egress, bad token, Expo
 * outage) is logged and swallowed — a notification must never break the run that
 * triggered it. Nothing here persists or logs credentials; a device push token is
 * not a secret in the credential sense, but we still never echo full tokens.
 */
import { listDeviceTokensForUser } from "./d1.js";

/**
 * A POST-capable fetch (the engine's `FetchFn` is headers-only). The Worker's
 * global `fetch` satisfies this; tests pass a fake. Kept minimal so nothing here
 * depends on the platform Response type.
 */
export type PushFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** The Expo Push service endpoint. Overridable via env for tests/self-host. */
export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** A single Expo push message. */
export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  /** deep-link payload the app maps to a route (runId → /runs/:id). */
  data?: Record<string, unknown>;
  sound?: "default";
  channelId?: string;
};

/** An Expo push token looks like `ExponentPushToken[xxxx]` / `ExpoPushToken[xxxx]`. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

export type RunNotification = {
  appName: string;
  runId: string;
  /** headline count for the body, when known ("3 fixes ready"). */
  fixLabel?: string | undefined;
};

/**
 * Build one message per (valid) token for a run that now awaits approval. Invalid
 * tokens are dropped (not sent), so a stale token never aborts the batch.
 */
export function buildRunReadyMessages(tokens: readonly string[], n: RunNotification): ExpoPushMessage[] {
  const title = `${n.appName}: a run is ready`;
  const body = n.fixLabel ? `${n.fixLabel} — review & approve.` : "Review the audit and approve when you're ready.";
  return tokens
    .filter(isExpoPushToken)
    .map((to) => ({
      to,
      title,
      body,
      sound: "default",
      data: { runId: n.runId, url: `/runs/${n.runId}` },
    }));
}

/**
 * POST messages to Expo. Returns the number of messages accepted (best-effort;
 * never throws). Chunks to Expo's 100-per-request limit.
 */
export async function sendExpoPush(
  fetch: PushFetch,
  messages: readonly ExpoPushMessage[],
  opts: { endpoint?: string } = {},
): Promise<number> {
  if (messages.length === 0) return 0;
  const endpoint = opts.endpoint ?? EXPO_PUSH_ENDPOINT;
  let accepted = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) accepted += chunk.length;
      else console.error(`[store-ops push] Expo push returned ${res.status}`);
    } catch (e) {
      // Blocked egress / network error — log and continue; never break the caller.
      console.error(`[store-ops push] Expo push send failed: ${String(e)}`);
    }
  }
  return accepted;
}

/**
 * Notify an app's OWNER that a run now awaits their approval. Loads the owner's
 * device tokens, builds + sends the batch. Best-effort end to end: no tokens → a
 * no-op; any send failure is swallowed. Returns how many messages Expo accepted
 * (0 when nobody's registered), so callers/tests can assert without a network.
 */
export async function notifyRunAwaitingApproval(
  fetch: PushFetch,
  db: D1Database,
  app: { user_id: string; name: string; bundle_id: string },
  runId: string,
  opts: { fixLabel?: string | undefined; endpoint?: string | undefined } = {},
): Promise<number> {
  try {
    const tokens = await listDeviceTokensForUser(db, app.user_id);
    if (tokens.length === 0) return 0;
    const messages = buildRunReadyMessages(tokens, {
      appName: app.name || app.bundle_id,
      runId,
      fixLabel: opts.fixLabel,
    });
    return await sendExpoPush(fetch, messages, opts.endpoint ? { endpoint: opts.endpoint } : {});
  } catch (e) {
    // Best-effort end to end: a token-read failure must NEVER abort the run/sweep
    // that triggered the notification.
    console.error(`[store-ops push] notify failed for app ${app.bundle_id}: ${String(e)}`);
    return 0;
  }
}
