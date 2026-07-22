import { describe, expect, it, vi } from "vitest";
import { maybeRegisterWebhook } from "./index.js"; // export a small seam for this

describe("maybeRegisterWebhook", () => {
  it("generates a secret, registers, and persists on success", async () => {
    const register = vi.fn(async () => ({ ok: true as const, webhookId: "W1", created: true }));
    const persist = vi.fn(async () => {});
    const res = await maybeRegisterWebhook(
      { token: "t", ascAppId: "6446", appId: "app_1", receiverUrl: "https://w/webhooks/asc" },
      { register, persist, genSecret: () => "whsec_generated" },
    );
    expect(res.enabled).toBe(true);
    expect(register).toHaveBeenCalledOnce();
    // Adapted from the brief's reference shape: the real persist dep is backed
    // by the SEALED `saveWebhookSecret(env, {ascAppId, appId, secret})` (Task
    // 5) — the sealed table needs the internal app row id alongside the ASC
    // numeric app id, so `appId` is threaded through here too.
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ ascAppId: "6446", appId: "app_1", webhookId: "W1", secret: "whsec_generated" }),
    );
  });

  it("degrades to cron-only (enabled:false) when registration throws, without throwing", async () => {
    const register = vi.fn(async () => {
      throw new Error("403");
    });
    const persist = vi.fn(async () => {});
    const res = await maybeRegisterWebhook(
      { token: "t", ascAppId: "6446", appId: "app_1", receiverUrl: "https://w/webhooks/asc" },
      { register, persist, genSecret: () => "s" },
    );
    expect(res.enabled).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("degrades to cron-only (enabled:false) when persist throws, without throwing", async () => {
    const register = vi.fn(async () => ({ ok: true as const, webhookId: "W1", created: true }));
    const persist = vi.fn(async () => {
      throw new Error("seal failed");
    });
    const res = await maybeRegisterWebhook(
      { token: "t", ascAppId: "6446", appId: "app_1", receiverUrl: "https://w/webhooks/asc" },
      { register, persist, genSecret: () => "s" },
    );
    expect(res.enabled).toBe(false);
  });
});
