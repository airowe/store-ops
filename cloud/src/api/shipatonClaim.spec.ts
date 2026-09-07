/**
 * POST /billing/claim {code} — the Shipaton Pass, through the REAL router.
 * A signed-in account types the code once; the server grants Startup until the
 * pass end, or says exactly why not. Never a demotion, never a Stripe call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHIPATON_PASS } from "../engine/shipatonPass.js";

let user: { id: string; email: string; created_at: string; tier: string; status: string; current_period_end: string | null };
const setTier = vi.fn(async () => {});
vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, setTier, upsertUser: async () => user };
});

const { handleApi } = await import("./index.js");

function fakeDb() {
  const stmt = { bind: () => stmt, first: async () => user, run: async () => ({ success: true, meta: { changes: 1 } }), all: async () => ({ results: [] }) };
  return { prepare: () => stmt } as never;
}
const ctx = { waitUntil: vi.fn() } as never;

const call = (env: Record<string, unknown>, method: string, path: string, body?: unknown) =>
  handleApi(
    new Request(`https://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { APP_ENV: "demo", DB: fakeDb(), SHIPATON_PASS_CODE: "SHIPATON26", ...env } as never,
    ctx,
  );

beforeEach(() => {
  user = { id: "u1", email: "u@e.com", created_at: "2026-01-01", tier: "free", status: "active", current_period_end: null };
  setTier.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
});

describe("POST /billing/claim", () => {
  it("grants Startup until the pass end and writes both tier columns plus the pass status", async () => {
    const res = await call({}, "POST", "/billing/claim", { code: "shipaton-26" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: "startup", until: SHIPATON_PASS.validUntil, pass: "shipaton-2026" });
    expect(setTier).toHaveBeenCalledWith(expect.anything(), {
      userId: "u1",
      tier: "startup",
      stripeTier: "startup",
      status: SHIPATON_PASS.status,
      currentPeriodEnd: SHIPATON_PASS.validUntil,
    });
  });

  it("refuses a wrong code with 400 and writes nothing", async () => {
    const res = await call({}, "POST", "/billing/claim", { code: "FOUNDERS" });
    expect(res.status).toBe(400);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("refuses to demote a paid account (409)", async () => {
    user.tier = "scale";
    expect((await call({}, "POST", "/billing/claim", { code: "SHIPATON26" })).status).toBe(409);
    expect(setTier).not.toHaveBeenCalled();
  });

  it("is 503 on a deploy with no code configured", async () => {
    expect((await call({ SHIPATON_PASS_CODE: undefined }, "POST", "/billing/claim", { code: "SHIPATON26" })).status).toBe(503);
  });

  it("is 410 once claims close", async () => {
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    expect((await call({}, "POST", "/billing/claim", { code: "SHIPATON26" })).status).toBe(410);
  });

  it("needs a session", async () => {
    const res = await handleApi(
      new Request("https://api.test/billing/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "SHIPATON26" }) }),
      { APP_ENV: "production", SESSION_SECRET: "s".repeat(32), DB: fakeDb(), SHIPATON_PASS_CODE: "SHIPATON26" } as never,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  it("reports the plan status and its end date so the dashboard can name the pass", async () => {
    user = { ...user, tier: "startup", status: SHIPATON_PASS.status, current_period_end: SHIPATON_PASS.validUntil };
    const res = await call({}, "GET", "/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tier: "startup", plan_status: SHIPATON_PASS.status, plan_until: SHIPATON_PASS.validUntil });
  });
});
