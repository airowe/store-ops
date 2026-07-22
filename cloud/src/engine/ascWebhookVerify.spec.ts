import { describe, expect, it } from "vitest";
import { parseWebhookEvent, verifyDelivery } from "./ascWebhookVerify.js";

const body = JSON.stringify({
  data: {
    id: "DELIV1",
    type: "webhookDeliveries",
    attributes: {
      eventType: "APP_STORE_VERSION_APP_VERSION_STATE_UPDATED",
      createdDate: "2026-07-22T10:00:00Z",
    },
    relationships: { app: { data: { id: "6446", type: "apps" } } },
  },
});

describe("parseWebhookEvent", () => {
  it("normalizes a well-formed delivery", () => {
    const e = parseWebhookEvent(body)!;
    expect(e.deliveryId).toBe("DELIV1");
    expect(e.eventType).toBe("APP_STORE_VERSION_APP_VERSION_STATE_UPDATED");
    expect(e.ascAppId).toBe("6446");
    expect(e.occurredAt).toBe("2026-07-22T10:00:00Z");
  });

  it("returns null on non-JSON", () => {
    expect(parseWebhookEvent("}{not json")).toBeNull();
  });

  it("returns null when the delivery id or app id is missing", () => {
    expect(parseWebhookEvent(JSON.stringify({ data: { attributes: { eventType: "X" } } }))).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ data: { id: "D", attributes: { eventType: "X" } } }))).toBeNull();
  });
});

// Compute a reference hex HMAC-SHA256 the same way the impl does — the test is
// self-consistent (no external fixture needed).
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("verifyDelivery", () => {
  const secret = "whsec_test";
  const raw = '{"data":{"id":"D1"}}';

  it("accepts a correct signature", async () => {
    const sig = await hmacHex(secret, raw);
    expect(await verifyDelivery(secret, raw, sig)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const sig = await hmacHex(secret, raw);
    expect(await verifyDelivery(secret, raw + " ", sig)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const sig = await hmacHex("other", raw);
    expect(await verifyDelivery(secret, raw, sig)).toBe(false);
  });

  it("rejects an empty or malformed signature without throwing", async () => {
    expect(await verifyDelivery(secret, raw, "")).toBe(false);
    expect(await verifyDelivery(secret, raw, "zz")).toBe(false);
  });

  // Apple delivers the signature as `x-apple-signature: hmacsha256=<hex>`, NOT a
  // bare hex string (per developer.apple.com/.../configuring-webhook-notifications).
  // The verifier MUST strip the `hmacsha256=` prefix before decoding, or every
  // real delivery fails verification (uniform 401).
  it("accepts Apple's real header format (hmacsha256=<hex>) — official worked example", async () => {
    // Apple's documented vector: secret "This is my secret" + body "Hello, World!".
    const appleSecret = "This is my secret";
    const appleBody = "Hello, World!";
    const appleHeader =
      "hmacsha256=7f062172b01cb00b53ca068614674a3d982a34062a0f5d37687d5e3377e54657";
    expect(await verifyDelivery(appleSecret, appleBody, appleHeader)).toBe(true);
  });

  it("accepts the prefixed form for an arbitrary body (case-insensitive prefix)", async () => {
    const hex = await hmacHex(secret, raw);
    expect(await verifyDelivery(secret, raw, `hmacsha256=${hex}`)).toBe(true);
    expect(await verifyDelivery(secret, raw, `HMACSHA256=${hex}`)).toBe(true);
  });

  it("rejects a prefixed signature with a tampered body", async () => {
    const hex = await hmacHex(secret, raw);
    expect(await verifyDelivery(secret, raw + " ", `hmacsha256=${hex}`)).toBe(false);
  });

  it("still accepts a bare hex signature (defensive — no prefix)", async () => {
    const hex = await hmacHex(secret, raw);
    expect(await verifyDelivery(secret, raw, hex)).toBe(true);
  });
});
