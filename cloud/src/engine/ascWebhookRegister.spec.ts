import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENT_TYPES, buildWebhookBody, listWebhooks, registerWebhook } from "./ascWebhookRegister.js";

const RECEIVER = "https://worker.example/webhooks/asc";

describe("WEBHOOK_EVENT_TYPES", () => {
  it("is the two ASO-relevant SCREAMING_SNAKE_CASE events", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "APP_STORE_VERSION_APP_VERSION_STATE_UPDATED",
      "BUILD_UPLOAD_STATE_UPDATED",
    ]);
  });
});

describe("buildWebhookBody", () => {
  it("builds a webhooks create body with url, secret, enabled, eventTypes, app link", () => {
    const b = buildWebhookBody("6446", RECEIVER, "whsec_x", [...WEBHOOK_EVENT_TYPES]) as any;
    expect(b.data.type).toBe("webhooks");
    expect(b.data.attributes.url).toBe(RECEIVER);
    expect(b.data.attributes.secret).toBe("whsec_x");
    expect(b.data.attributes.enabled).toBe(true);
    expect(b.data.attributes.eventTypes).toEqual([...WEBHOOK_EVENT_TYPES]);
    expect(b.data.relationships.app.data.id).toBe("6446");
  });
});

describe("listWebhooks", () => {
  it("fetches the list of webhooks via the ASC API", async () => {
    const fetchFn = async () =>
      ({ ok: true, json: async () => ({ data: [{ id: "w1", attributes: { url: RECEIVER } }] }) }) as unknown as Response;
    const res = await listWebhooks(fetchFn, { token: "t", ascAppId: "6446" });
    expect(res).toEqual([{ id: "w1", url: RECEIVER }]);
  });
});

describe("registerWebhook", () => {
  const okList = (ids: Array<{ id: string; url: string }>) =>
    ({ ok: true, json: async () => ({ data: ids.map((r) => ({ id: r.id, attributes: { url: r.url } })) }) }) as unknown as Response;
  const okCreate = (id: string) => ({ ok: true, json: async () => ({ data: { id } }) }) as unknown as Response;

  it("is idempotent: returns the existing webhook (created:false) without POSTing", async () => {
    let posted = false;
    const fetchFn = async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") { posted = true; return okCreate("NEW"); }
      return okList([{ id: "EXIST", url: RECEIVER }]);
    };
    const res = await registerWebhook(fetchFn, { token: "t", ascAppId: "6446", url: RECEIVER, secret: "s" });
    expect(res.created).toBe(false);
    expect(res.webhookId).toBe("EXIST");
    expect(posted).toBe(false);
  });

  it("creates (created:true) when none exists for our receiver url", async () => {
    const fetchFn = async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? okCreate("NEW") : okList([{ id: "OTHER", url: "https://someone-else/hook" }]);
    const res = await registerWebhook(fetchFn, { token: "t", ascAppId: "6446", url: RECEIVER, secret: "s" });
    expect(res.created).toBe(true);
    expect(res.webhookId).toBe("NEW");
  });

  it("dryRun returns the exact body and never POSTs", async () => {
    let posted = false;
    const fetchFn = async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") posted = true;
      return okList([]);
    };
    const res = await registerWebhook(fetchFn, { token: "t", ascAppId: "6446", url: RECEIVER, secret: "s", dryRun: true });
    expect(posted).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.body).toEqual(buildWebhookBody("6446", RECEIVER, "s", [...WEBHOOK_EVENT_TYPES]));
  });

  it("throws AscWriteError on a non-OK create, message omits the secret", async () => {
    const fetchFn = async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? ({ ok: false, status: 409, json: async () => ({ errors: [{ detail: "conflict" }] }) }) as unknown as Response
        : okList([]);
    await registerWebhook(fetchFn, { token: "t", ascAppId: "6446", url: RECEIVER, secret: "whsec_SECRET" })
      .catch((e) => expect(String(e.message)).not.toContain("whsec_SECRET"));
  });
});
