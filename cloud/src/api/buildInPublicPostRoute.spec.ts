/**
 * GET /apps/:id/buildinpublic-post — the emitter endpoint, through the REAL
 * router. The d1 + digest boundary is mocked so the real `buildInPublicPost`
 * composer runs on a controlled deltas view; this asserts the route's contract:
 * owner scope, the required storeUrl param, the honesty 404, and the payload.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RankDeltaView } from "../digest.js";

let view: RankDeltaView;
const app = {
  id: "app-1",
  user_id: "u1",
  bundle_id: "com.shipaso.app",
  name: "ShipASO",
  country: "us",
  created_at: "2026-01-01",
};

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    upsertUser: async () => ({ id: "u1", email: "u@e.co" }),
    getApp: async () => app,
    getRankHistory: async () => [],
  };
});

vi.mock("../digest.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, rankDeltasView: () => view };
});

const { handleApi } = await import("./index.js");

const env = { APP_ENV: "demo", DB: {} } as never;

const get = (path: string) =>
  handleApi(
    new Request(`https://api.test${path}`, {
      method: "GET",
      headers: { "x-user-email": "u@e.co" },
    }),
    env,
    {} as never,
  );

const STORE = encodeURIComponent("https://apps.apple.com/app/id6787632160");
const climbView: RankDeltaView = {
  entries: [{ keyword: "budget tracker", current: 12, previous: 40, delta: -28, direction: "up" }],
} as RankDeltaView;
const holdView: RankDeltaView = {
  entries: [{ keyword: "x", current: 30, previous: 30, delta: 0, direction: "same" }],
} as RankDeltaView;

beforeEach(() => {
  view = climbView;
});

describe("GET /apps/:id/buildinpublic-post", () => {
  it("returns the composed post text + proof card for a real win", async () => {
    const res = await get(`/apps/app-1/buildinpublic-post?storeUrl=${STORE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; hashtags: string[]; cardSvg: string };
    expect(body.text).toContain("#40 → #12");
    expect(body.text).toContain("up 28 spots");
    expect(body.text).toContain("https://apps.apple.com/app/id6787632160");
    expect(body.text).toContain("#BuildInPublic");
    expect(body.hashtags).toEqual(["#BuildInPublic", "#Shipaton"]);
    expect(body.cardSvg).toContain("<svg");
  });

  it("404s (post nothing) when there is no genuine win", async () => {
    view = holdView;
    const res = await get(`/apps/app-1/buildinpublic-post?storeUrl=${STORE}`);
    expect(res.status).toBe(404);
  });

  it("400s when storeUrl is missing", async () => {
    const res = await get(`/apps/app-1/buildinpublic-post`);
    expect(res.status).toBe(400);
  });

  it("400s when storeUrl is not an https URL", async () => {
    const res = await get(`/apps/app-1/buildinpublic-post?storeUrl=${encodeURIComponent("ftp://x")}`);
    expect(res.status).toBe(400);
  });
});
