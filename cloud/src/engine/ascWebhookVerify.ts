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

/** Hex-decode to bytes, or null on odd/invalid hex. */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Length-equalized constant-time byte compare. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Compare against the max length so a length mismatch doesn't short-circuit.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Constant-time HMAC-SHA256 verification of a raw webhook body against the
 * app's stored secret. `signatureHeader` is the hex digest Apple sent. Returns
 * false (never throws) on any malformed input.
 */
export async function verifyDelivery(
  secret: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const provided = hexToBytes(signatureHeader.trim().toLowerCase());
  if (!provided) return false;
  let expected: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  } catch {
    return false;
  }
  return timingSafeEqual(provided, new Uint8Array(expected));
}
