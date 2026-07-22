import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "./ascWebhookVerify.js";

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
