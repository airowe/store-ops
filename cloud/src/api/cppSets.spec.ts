/**
 * POST /cpp/sets (#154 Part 2) — the route glue: validation, auth, delegation to
 * buildCppSets over the AI reasoner. The engine's logic (clustering, sparse-data
 * floor, per-intent grounding) is covered in engine/cppSets.spec.ts; here we drive
 * the real handleApi and confirm the wiring + the sparse-refusal + degrade paths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let reasonerReturns: string | null = null;
vi.mock("./aiReasoner.js", () => ({
  reasonerForEnv: () => (reasonerReturns === null ? undefined : async () => reasonerReturns as string),
}));

import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function fakeUsersDb(): D1Database {
  const users = new Map<string, { id: string; email: string }>();
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE email = \?/.test(s)) return (users.get(String(bound[0])) ?? null) as T | null;
        if (/FROM users WHERE id = \?/.test(s)) return ([...users.values()].find((u) => u.id === bound[0]) ?? null) as T | null;
        return null as T | null;
      },
      async run() {
        if (/^INSERT INTO users/.test(s)) users.set(String(bound[1]), { id: String(bound[0]), email: String(bound[1]) });
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() { return { results: [] as T[] }; },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(): Env {
  return { DB: fakeUsersDb(), DEFAULT_COUNTRY: "US", APP_ENV: "demo", AI: {} as unknown } as Env;
}

const INPUTS = {
  appName: "Weatherly",
  subtitle: "Honest forecasts",
  keywords: ["weather radar", "weather map", "trip forecast", "trip planner"],
  rawScreens: ["home", "map", "timeline"],
  auditGrade: "C",
  findings: ["Only 3 screenshots — plan for 6"],
  brandPalette: ["#34d399"],
  recommendedCount: 3,
};

function req(body: unknown, email = "owner@example.com"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (email) headers["x-user-email"] = email;
  return new Request("https://api.test/cpp/sets", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  reasonerReturns = null;
});

describe("POST /cpp/sets", () => {
  it("returns one set per intent (degraded without an AI binding, never errors)", async () => {
    const res = await handleApi(req(INPUTS), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sets?: Array<{ intent: { label: string } }>; intentsMeasured?: number };
    expect(body.ok).toBe(true);
    expect((body.sets ?? []).length).toBeGreaterThanOrEqual(2);
    expect((body.sets ?? []).map((s) => s.intent.label).sort()).toEqual(["trip", "weather"]);
  });

  it("returns the sparse-data refusal (200, ok:false) when there aren't enough intents", async () => {
    const res = await handleApi(req({ ...INPUTS, keywords: ["weather"] }), makeEnv());
    expect(res.status).toBe(200); // a refusal is a valid answer, not an error
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/not enough measured keywords/i);
  });

  it("400 without an appName", async () => {
    const { appName, ...noName } = INPUTS;
    void appName;
    expect((await handleApi(req(noName), makeEnv())).status).toBe(400);
  });

  it("401 without a user", async () => {
    expect((await handleApi(req(INPUTS, ""), makeEnv())).status).toBe(401);
  });
});
