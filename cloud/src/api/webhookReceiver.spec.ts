import { describe, expect, it, vi } from "vitest";
import { handleWebhookReceive } from "./webhookReceiver.js";

const SECRET = "whsec_test";
const RAW = JSON.stringify({
  data: {
    id: "D1",
    attributes: { eventType: "BUILD_UPLOAD_STATE_UPDATED", createdDate: "2026-07-22T10:00:00Z" },
    relationships: { app: { data: { id: "6446" } } },
  },
});

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ctx() { return { waitUntil: (_p: Promise<unknown>) => {} } as unknown as ExecutionContext; }
function req(body: string, sig: string) {
  return new Request("https://w/webhooks/asc", { method: "POST", body, headers: { "x-apple-signature": sig } });
}

const baseDeps = (over: any = {}) => ({
  resolveAppAndSecret: async () => ({ app: { id: "app-1" } as any, secret: SECRET }),
  runKeyedSweepForApp: vi.fn(async () => "run-1"),
  enqueue: async () => ({ fresh: true }),
  shouldDebounce: async () => false,
  markSwept: async () => {},
  now: () => 1_753_180_800,
  ...over,
});

describe("handleWebhookReceive", () => {
  it("401s on a bad signature and never sweeps", async () => {
    const deps = baseDeps();
    const res = await handleWebhookReceive(req(RAW, "deadbeef"), {} as any, ctx(), deps);
    expect(res.status).toBe(401);
    expect(deps.runKeyedSweepForApp).not.toHaveBeenCalled();
  });

  it("401s when the app/secret can't be resolved", async () => {
    const deps = baseDeps({ resolveAppAndSecret: async () => null });
    const res = await handleWebhookReceive(req(RAW, await sign(SECRET, RAW)), {} as any, ctx(), deps);
    expect(res.status).toBe(401);
  });

  it("200 + schedules a sweep on a fresh, non-debounced, verified delivery", async () => {
    const deps = baseDeps();
    const res = await handleWebhookReceive(req(RAW, await sign(SECRET, RAW)), {} as any, ctx(), deps);
    expect(res.status).toBe(200);
    expect(deps.runKeyedSweepForApp).toHaveBeenCalledTimes(1);
  });

  it("200 + no sweep on a duplicate delivery", async () => {
    const deps = baseDeps({ enqueue: async () => ({ fresh: false }) });
    const res = await handleWebhookReceive(req(RAW, await sign(SECRET, RAW)), {} as any, ctx(), deps);
    expect(res.status).toBe(200);
    expect(deps.runKeyedSweepForApp).not.toHaveBeenCalled();
  });

  it("200 + no sweep when debounced", async () => {
    const deps = baseDeps({ shouldDebounce: async () => true });
    const res = await handleWebhookReceive(req(RAW, await sign(SECRET, RAW)), {} as any, ctx(), deps);
    expect(res.status).toBe(200);
    expect(deps.runKeyedSweepForApp).not.toHaveBeenCalled();
  });

  it("400 on a malformed (but correctly-signed) body", async () => {
    // The app id is resolvable (so we CAN verify against the right secret),
    // but the payload is otherwise malformed (missing eventType) — a body
    // that's syntactically invalid JSON can never reach a specific app's
    // secret at all (nothing to key the lookup on), so it 401s like any
    // other unattributable delivery; this is the genuinely-reachable 400.
    const bad = JSON.stringify({
      data: { id: "D1", attributes: {}, relationships: { app: { data: { id: "6446" } } } },
    });
    const deps = baseDeps();
    const res = await handleWebhookReceive(req(bad, await sign(SECRET, bad)), {} as any, ctx(), deps);
    expect(res.status).toBe(400);
  });

  it("401 on a body with no attributable app id, even if 'signed'", async () => {
    // Nothing to resolve a secret against — this can never be distinguished
    // from an attacker sending garbage, so it's unauthorized, not malformed.
    const bad = "not json";
    const deps = baseDeps();
    const res = await handleWebhookReceive(req(bad, await sign(SECRET, bad)), {} as any, ctx(), deps);
    expect(res.status).toBe(401);
    expect(deps.runKeyedSweepForApp).not.toHaveBeenCalled();
  });
});
