/**
 * GET /apps/:id/standing — the keyword standing endpoint (#473), through the
 * REAL router. The d1 boundary is mocked so the real `standingFromHistory` runs
 * over a controlled snapshot history; this asserts the route's contract: owner
 * scope, the honest payload, and that the two fields `rankDeltasView` drops
 * (`total`, `checked_at`) actually reach the client.
 */
import { describe, expect, it, vi } from "vitest";
import type { RankSnapshotRow } from "../d1.js";

const app = {
  id: "app-1",
  user_id: "u1",
  bundle_id: "app.airowe.clarity",
  name: "Heathen",
  country: "us",
  created_at: "2026-01-01",
};

// Heathen's real shape (production D1): two readings for one term, strong
// holds, and an unranked tail.
const HISTORY: RankSnapshotRow[] = [
  { id: "1", app_id: "app-1", keyword: "heathen", rank: 6, total: 36, country: "us", checked_at: "2026-07-06T00:00:00Z" },
  { id: "2", app_id: "app-1", keyword: "heathen", rank: 2, total: 42, country: "us", checked_at: "2026-08-01T00:00:00Z" },
  { id: "3", app_id: "app-1", keyword: "secular", rank: 1, total: 167, country: "us", checked_at: "2026-08-01T00:00:00Z" },
  { id: "4", app_id: "app-1", keyword: "anxiety", rank: null, total: 180, country: "us", checked_at: "2026-08-10T00:00:00Z" },
];

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    upsertUser: async () => ({ id: "u1", email: "u@e.co" }),
    getApp: async (_db: unknown, id: string) => (id === app.id ? app : null),
    getRankHistory: async () => HISTORY,
    listRunsForApp: async () => [],
  };
});

const { handleApi } = await import("./index.js");
const env = { APP_ENV: "demo", DB: {} } as never;

const get = (path: string, email = "u@e.co") =>
  handleApi(
    new Request(`https://api.test${path}`, { method: "GET", headers: { "x-user-email": email } }),
    env,
    {} as never,
  );

type Payload = {
  entries: { keyword: string; rank: number | null; total: number | null; checked_at: string }[];
  ranked: number;
  tracked: number;
  best: number | null;
};

describe("GET /apps/:id/standing", () => {
  it("returns the latest reading per keyword, best position first", async () => {
    const res = await get("/apps/app-1/standing");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Payload;
    expect(body.entries.map((e) => e.keyword)).toEqual(["secular", "heathen", "anxiety"]);
    // the LATEST heathen reading (#2 on Aug 1), not the earlier #6
    expect(body.entries[1]?.rank).toBe(2);
  });

  it("carries total and checked_at — the fields the deltas view drops", async () => {
    const body = (await (await get("/apps/app-1/standing")).json()) as Payload;
    const secular = body.entries.find((e) => e.keyword === "secular");
    expect(secular?.total).toBe(167);
    expect(secular?.checked_at).toBe("2026-08-01T00:00:00Z");
  });

  it("keeps an unranked term null rather than plotting it at the scan depth", async () => {
    const body = (await (await get("/apps/app-1/standing")).json()) as Payload;
    const anxiety = body.entries.find((e) => e.keyword === "anxiety");
    expect(anxiety?.rank).toBeNull();
    expect(anxiety?.total).toBe(180);
  });

  it("counts each keyword once and reports the honest headline", async () => {
    const body = (await (await get("/apps/app-1/standing")).json()) as Payload;
    expect(body).toMatchObject({ ranked: 2, tracked: 3, best: 1 });
  });

  it("404s for an app the caller does not own, before reading any history", async () => {
    const res = await get("/apps/someone-elses/standing");
    expect(res.status).toBe(404);
  });

  it("401s without a caller", async () => {
    const res = await handleApi(
      new Request("https://api.test/apps/app-1/standing", { method: "GET" }),
      env,
      {} as never,
    );
    expect(res.status).toBe(401);
  });
});
