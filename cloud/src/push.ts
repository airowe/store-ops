/**
 * Expo push — build + send notifications via the Expo Push API. Pure message
 * construction (unit-tested) plus a thin sender that takes an injected fetch,
 * exactly like the rest of the engine, so it tests with zero network.
 *
 * The send is BEST-EFFORT: a delivery failure (blocked egress, bad token, Expo
 * outage) is logged and swallowed — a notification must never break the run that
 * triggered it — and the request is TIME-BOUNDED so a hung Expo endpoint can't
 * stall the cron sweep it rides on. Tokens Expo reports as `DeviceNotRegistered`
 * are pruned so dead devices don't accumulate. Nothing here persists or logs
 * credentials; full push tokens are never echoed.
 */
import { deleteDeviceToken, listDeviceTokensForUser } from "./d1.js";

/**
 * A POST-capable fetch (the engine's `FetchFn` is headers-only). The Worker's
 * global `fetch` satisfies this; tests pass a fake. `text()` is optional so a
 * minimal fake can skip the receipt-parsing path.
 */
export type PushFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text?: () => Promise<string> }>;

/** The Expo Push service endpoint. Overridable via env for tests/self-host. */
export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Hard cap per Expo request, so a hung endpoint can't stall the cron sweep. */
const SEND_TIMEOUT_MS = 10_000;

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

export type SendResult = {
  /** messages Expo actually ACCEPTED (per-ticket "ok" when receipts are readable;
   *  the posted count otherwise — honest best-effort, never inflated by parseable
   *  error tickets). */
  accepted: number;
  /** tokens Expo reported as DeviceNotRegistered — prune these. */
  unregistered: string[];
};

/** AbortSignal.timeout where the runtime has it (workerd + Node 18+); else none. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const t = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
}

/**
 * POST messages to Expo. Best-effort and time-bounded; never throws. Parses the
 * per-message receipt tickets when the response exposes a body, so the accepted
 * count is real and dead tokens surface for pruning.
 */
export async function sendExpoPush(
  fetch: PushFetch,
  messages: readonly ExpoPushMessage[],
  opts: { endpoint?: string } = {},
): Promise<SendResult> {
  const result: SendResult = { accepted: 0, unregistered: [] };
  if (messages.length === 0) return result;
  const endpoint = opts.endpoint ?? EXPO_PUSH_ENDPOINT;

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const init: Parameters<PushFetch>[1] = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(chunk),
      };
      const signal = timeoutSignal(SEND_TIMEOUT_MS);
      if (signal) init.signal = signal;
      const res = await fetch(endpoint, init);
      if (!res.ok) {
        console.error(`[store-ops push] Expo push returned ${res.status}`);
        continue;
      }
      // Expo answers 200 with per-message tickets: {data:[{status:"ok"|"error",…}]}.
      // Without a readable body (minimal fakes), count the whole posted chunk.
      const tickets = res.text ? await parseTickets(res.text) : null;
      if (!tickets) {
        result.accepted += chunk.length;
        continue;
      }
      tickets.forEach((t, j) => {
        if (t.status === "ok") result.accepted++;
        else if (t.details?.error === "DeviceNotRegistered" && chunk[j]) {
          result.unregistered.push(chunk[j].to);
        }
      });
    } catch (e) {
      // Blocked egress / timeout / network error — log and continue; never break the caller.
      console.error(`[store-ops push] Expo push send failed: ${String(e)}`);
    }
  }
  return result;
}

type Ticket = { status?: string; details?: { error?: string } };

/** Parse Expo's ticket array; null on any malformed body (treat as unparseable). */
async function parseTickets(text: () => Promise<string>): Promise<Ticket[] | null> {
  try {
    const parsed = JSON.parse(await text()) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Ticket[]) : null;
  } catch {
    return null;
  }
}

/**
 * Notify an app's OWNER that a run now awaits their approval. Loads the owner's
 * device tokens, builds + sends the batch, and prunes tokens Expo reports dead.
 * Best-effort end to end: no tokens → a no-op; any failure is swallowed. Returns
 * how many messages Expo accepted (0 when nobody's registered), so callers/tests
 * can assert without a network.
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
    const sent = await sendExpoPush(fetch, messages, opts.endpoint ? { endpoint: opts.endpoint } : {});
    // Prune dead devices so future sweeps stop paying for them. Best-effort too.
    for (const token of sent.unregistered) {
      try {
        await deleteDeviceToken(db, token);
      } catch {
        /* pruning is hygiene — never let it fail the notify */
      }
    }
    return sent.accepted;
  } catch (e) {
    // Best-effort end to end: a token-read failure must NEVER abort the run/sweep
    // that triggered the notification.
    console.error(`[store-ops push] notify failed for app ${app.bundle_id}: ${String(e)}`);
    return 0;
  }
}
