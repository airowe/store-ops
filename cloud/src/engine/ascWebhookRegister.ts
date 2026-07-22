/**
 * Register/list/delete a ShipASO webhook on an app's ASC account. Approve→push
 * posture: dryRun returns the exact body without writing; idempotent create
 * (skip when a webhook for OUR receiver url already exists). AscWriteError
 * (secret-free) on failure. The secret never appears in a log/error/response.
 */
import { ASC_BASE, AscWriteError, ascError, type FetchLike } from "./ascWrite.js";

/** The ASO-relevant webhook event types (Apple WebhookEventType, verified
 *  2026-07-22, SCREAMING_SNAKE_CASE). Apple has NO review/metadata event. */
export const WEBHOOK_EVENT_TYPES: readonly string[] = [
  "APP_STORE_VERSION_APP_VERSION_STATE_UPDATED",
  "BUILD_UPLOAD_STATE_UPDATED",
] as const;

export type RegisterResult = {
  ok: true;
  webhookId: string;
  created: boolean;
  dryRun?: true;
  body?: unknown;
};

/** Pure body builder for a webhooks create. */
export function buildWebhookBody(
  ascAppId: string,
  url: string,
  secret: string,
  eventTypes: string[],
): unknown {
  return {
    data: {
      type: "webhooks",
      attributes: { url, secret, enabled: true, eventTypes },
      relationships: { app: { data: { type: "apps", id: ascAppId } } },
    },
  };
}

/** List the app's webhooks (id + url) — used by the idempotency check. */
export async function listWebhooks(
  fetchFn: FetchLike,
  opts: { token: string; ascAppId: string },
): Promise<Array<{ id: string; url: string }>> {
  const res = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.ascAppId)}/webhooks?limit=200`,
    { headers: { authorization: `Bearer ${opts.token}` } },
  );
  if (!res.ok) throw await ascError(res, "list webhooks");
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id?: string; attributes?: { url?: string } }>;
  };
  return (body.data ?? []).map((w) => ({ id: String(w.id ?? ""), url: String(w.attributes?.url ?? "") }));
}

export async function registerWebhook(
  fetchFn: FetchLike,
  opts: { token: string; ascAppId: string; url: string; secret: string; eventTypes?: string[]; dryRun?: boolean },
): Promise<RegisterResult> {
  const eventTypes = opts.eventTypes ?? [...WEBHOOK_EVENT_TYPES];
  const body = buildWebhookBody(opts.ascAppId, opts.url, opts.secret, eventTypes);

  // Idempotency: a ShipASO webhook is one whose url matches OUR receiver url.
  const existing = (await listWebhooks(fetchFn, opts)).find((w) => w.url === opts.url);
  if (existing) return { ok: true, webhookId: existing.id, created: false };

  if (opts.dryRun) return { ok: true, webhookId: "", created: false, dryRun: true, body };

  const res = await fetchFn(`${ASC_BASE}/webhooks`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await ascError(res, "create webhook");
  const parsed = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  const webhookId = parsed.data?.id;
  if (!webhookId) throw new AscWriteError("Webhook was created but Apple returned no id.");
  return { ok: true, webhookId, created: true };
}

export async function deleteWebhook(
  fetchFn: FetchLike,
  opts: { token: string; webhookId: string },
): Promise<void> {
  const res = await fetchFn(`${ASC_BASE}/webhooks/${encodeURIComponent(opts.webhookId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${opts.token}` },
  });
  if (!res.ok && res.status !== 404) throw await ascError(res, "delete webhook");
}
