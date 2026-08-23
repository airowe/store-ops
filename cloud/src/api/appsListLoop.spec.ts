/**
 * `GET /apps` must actually carry `loop` — the field the dashboard renders.
 *
 * The shaping (toLoopState) and the SQL are covered elsewhere: the former by
 * unit tests, the latter by running it against production D1. What neither
 * proves is that the two are WIRED — that the query's columns reach the mapper
 * and the mapper's output reaches the response body. That is this test.
 *
 * Driven through the real `handleApi` router with an in-memory D1 that answers
 * only the reads this route makes.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const USER = { id: "u1", email: "owner@example.com", created_at: "2026-06-01T00:00:00Z", tier: "scale", status: "active" };

function fakeDb(appRow: Record<string, unknown>) {
  const exec = (sql: string) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/FROM users WHERE email = \?/.test(s)) return { row: USER, rows: [] };
    if (/FROM users WHERE id = \?/.test(s)) return { row: USER, rows: [] };
    // the app-list query — identified by the loop columns it selects
    if (/agent_run_count/.test(s) && /FROM apps a/.test(s)) return { row: appRow, rows: [appRow] };
    return { row: null, rows: [] };
  };
  const stmt = (sql: string) => ({
    bind: () => stmt(sql),
    first: async () => exec(sql).row,
    all: async () => ({ results: exec(sql).rows }),
    run: async () => ({ success: true }),
  });
  return { prepare: (sql: string) => stmt(sql), batch: async () => [] } as unknown as D1Database;
}

const env = (db: D1Database) => ({ DB: db, APP_ENV: "demo", SESSION_SECRET: "x".repeat(40) }) as unknown as Env;

async function listApps(appRow: Record<string, unknown>) {
  const res = await handleApi(
    new Request("https://api.test/apps", { headers: { "X-User-Email": USER.email } }),
    env(fakeDb(appRow)),
    {} as ExecutionContext,
  );
  return (await res.json()) as { apps: Array<Record<string, unknown>> };
}

const baseApp = {
  id: "a1", user_id: "u1", bundle_id: "com.x.app", name: "App", country: "US",
  created_at: "2026-06-01T00:00:00Z", latest_run_id: null, latest_run_status: null,
};

describe("GET /apps carries loop state", () => {
  it("surfaces a swept app's loop state in the response body", async () => {
    const body = await listApps({
      ...baseApp,
      last_sweep_at: "2026-08-17T09:00:00Z",
      schedule_json: null,
      agent_run_count: 9,
      agent_since: "2026-06-21T09:00:00Z",
    });

    const loop = body.apps[0]!.loop as Record<string, unknown>;
    expect(loop).toBeTruthy();
    expect(loop.last_sweep_at).toBe("2026-08-17T09:00:00Z");
    expect(loop.agent_run_count).toBe(9);
    expect(loop.agent_since).toBe("2026-06-21T09:00:00Z");
    // computed, not passed through — proves nextSweepAt actually ran
    expect(typeof loop.next_sweep_at).toBe("string");
  });

  it("a never-swept app reports nulls and a zero count, not absent keys", async () => {
    const body = await listApps({
      ...baseApp,
      last_sweep_at: null, schedule_json: null, agent_run_count: null, agent_since: null,
    });

    const loop = body.apps[0]!.loop as Record<string, unknown>;
    expect(loop.last_sweep_at).toBeNull();
    expect(loop.agent_since).toBeNull();
    expect(loop.agent_run_count).toBe(0);
  });
});
