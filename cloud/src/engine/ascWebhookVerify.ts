/**
 * ASC webhook delivery verification + parsing. PURE + no network — HMAC uses
 * Web Crypto. Verification is constant-time; parsing tolerates garbage.
 *
 * The webhook secret is the ONLY credential touched and is never logged/returned.
 */

/** A normalized webhook delivery. */
export type WebhookEvent = {
  deliveryId: string; // Apple's unique delivery id — the dedup key
  eventType: string; // SCREAMING_SNAKE_CASE
  ascAppId: string; // the ASC numeric app id the event concerns
  occurredAt: string; // ISO
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse Apple's webhook JSON into a WebhookEvent, or null when malformed. */
export function parseWebhookEvent(rawBody: string): WebhookEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const data = (obj as { data?: unknown }).data as Record<string, unknown> | undefined;
  if (!data) return null;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  const rels = (data.relationships ?? {}) as Record<string, unknown>;
  const appData = ((rels.app as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;

  const deliveryId = str(data.id);
  const ascAppId = str(appData.id);
  const eventType = str(attrs.eventType);
  if (!deliveryId || !ascAppId || !eventType) return null;

  return { deliveryId, eventType, ascAppId, occurredAt: str(attrs.createdDate) };
}
