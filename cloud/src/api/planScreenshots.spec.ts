/**
 * POST /plan/screenshots (#153 ShipShots planner) — the route glue: input
 * validation, auth, and delegation to the engine over the AI reasoner. The
 * engine's own logic (headline lint, MISSING guard, template/accent whitelist,
 * deterministic degrade) is covered in engine/screenshotPlanner.spec.ts; here we
 * drive the real `handleApi` and confirm the wiring + degrade path.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// A reasoner that returns a canned plan; undefined when there's no AI binding.
let reasonerReturns: string | null = null;
vi.mock("./aiReasoner.js", () => ({
  reasonerForEnv: () =>
    reasonerReturns === null ? undefined : async () => reasonerReturns as string,
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
  appName: "ShipASO - Rank Tracker",
  subtitle: "Prove your keyword ranks moved",
  keywords: ["aso", "keyword rank"],
  rawScreens: ["dashboard", "rank-graph", "keyword-list"],
  audit: { grade: "C", recommendedCount: 3, findings: ["Only 3 screenshots — plan for 6"] },
  brandPalette: ["#34d399", "#0d0f14"],
};

const CANNED_PLAN = JSON.stringify({
  narrative: "Lead with rank proof.",
  shots: [
    { sourceScreen: "rank-graph", headline: "Prove your rank moved", templateId: "headline-top", accent: "#34d399" },
    { sourceScreen: "dashboard", headline: "See every keyword", templateId: "full-bleed" },
    { sourceScreen: "keyword-list", headline: "Track what matters", templateId: "duo" },
  ],
});

function req(body: unknown, email = "owner@example.com"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (email) headers["x-user-email"] = email;
  return new Request("https://api.test/plan/screenshots", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  reasonerReturns = null;
});

describe("POST /plan/screenshots", () => {
  it("returns the model's reconciled plan when a reasoner is present", async () => {
    reasonerReturns = CANNED_PLAN;
    const res = await handleApi(req(INPUTS), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shots: Array<{ headline: string }>; degraded: boolean };
    expect(body.degraded).toBe(false);
    expect(body.shots.length).toBe(3);
    expect(body.shots[0]!.headline).toBe("Prove your rank moved");
  });

  it("degrades to a deterministic plan (never errors) with no AI binding", async () => {
    reasonerReturns = null; // reasonerForEnv → undefined
    const res = await handleApi(req(INPUTS), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shots: unknown[]; degraded: boolean };
    expect(body.degraded).toBe(true);
    expect(body.shots.length).toBe(INPUTS.audit.recommendedCount);
  });

  it("400 without an appName", async () => {
    const { appName, ...noName } = INPUTS;
    void appName;
    expect((await handleApi(req(noName), makeEnv())).status).toBe(400);
  });

  it("400 when audit.recommendedCount is missing/invalid", async () => {
    const bad = { ...INPUTS, audit: { grade: "C", findings: [] } };
    expect((await handleApi(req(bad), makeEnv())).status).toBe(400);
  });

  it("401 without a user", async () => {
    expect((await handleApi(req(INPUTS, ""), makeEnv())).status).toBe(401);
  });
});
