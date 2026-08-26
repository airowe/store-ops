/**
 * Are the spend bounds actually WIRED?
 *
 * A bound that nothing calls is worse than no bound: it reads as protection in
 * review while the endpoint stays open. The policy specs in agentBounds.spec.ts
 * would pass either way, so this asserts the call sites exist and that a real
 * request is refused with 429.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const API = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url).href), "utf8");

const EMAIL = "owner@example.com";

/** D1 stand-in with a knob for how many recent runs / daily apps exist. */
function fakeDb(opts: { runCount: number; dailyApps: number }): D1Database {
  const user = { id: "u1", email: EMAIL, tier: "free", status: "active", agent_paused: 0 };
  const app = { id: "app_1", user_id: "u1", bundle_id: "com.acme.app", name: "Acme", country: "US" };
  function exec(sql: string): { row: unknown; results?: unknown[] } {
    const s = sql.trim().replace(/\s+/g, " ");
    if (/COUNT\(\*\) AS n FROM runs/i.test(s)) return { row: { n: opts.runCount } };
    if (/schedule_json AS schedule_json FROM app_settings/i.test(s)) {
      return {
        row: null,
        results: Array.from({ length: opts.dailyApps }, () => ({
          schedule_json: JSON.stringify({ cadence: "daily", day: 1, hourUtc: 9 }),
        })),
      };
    }
    if (/FROM users WHERE email/i.test(s) || /FROM users WHERE id/i.test(s)) return { row: user };
    if (/FROM apps WHERE id/i.test(s)) return { row: app };
    if (/FROM app_settings WHERE app_id/i.test(s)) return { row: null };
    return { row: null, results: [] };
  }
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() { void bound; return exec(sql).row as T | null; },
      async run() { return { success: true, meta: { changes: 1 } }; },
      async all<T>() { return { results: (exec(sql).results ?? []) as T[] }; },
    };
    return stmt;
  }
  return { prepare, batch: async (st: unknown[]) => st.map(() => ({ success: true })) } as unknown as D1Database;
}

const env = (o: { runCount: number; dailyApps: number }) =>
  ({ DB: fakeDb(o), DEFAULT_COUNTRY: "US", APP_ENV: "demo" }) as Env;

const post = (path: string, body?: unknown) =>
  new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "x-user-email": EMAIL, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe("run trigger bound is wired", () => {
  it("REFUSES 429 once the hourly allowance is spent", async () => {
    const res = await handleApi(post("/apps/app_1/run"), env({ runCount: 99, dailyApps: 0 }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/limit/i) });
  });

  it("is checked BEFORE the agent runs — no inference is spent on a refused call", () => {
    const fn = API.slice(API.indexOf("async function runApp("));
    const guard = fn.indexOf("enforceRunTriggerBound");
    const work = fn.indexOf("runAgent(");
    expect(guard).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(work);
  });
});

describe("daily cadence bound is wired", () => {
  it("REFUSES 429 for daily beyond the free tier's single app", async () => {
    const res = await handleApi(
      post("/apps/app_1/schedule", { cadence: "daily", day: 1, hourUtc: 9 }),
      env({ runCount: 0, dailyApps: 3 }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/daily/i) });
  });

  it("ALLOWS weekly regardless of how many apps are already daily", async () => {
    const res = await handleApi(
      post("/apps/app_1/schedule", { cadence: "weekly", day: 1, hourUtc: 9 }),
      env({ runCount: 0, dailyApps: 99 }),
    );
    expect(res.status).toBe(200);
  });
});
