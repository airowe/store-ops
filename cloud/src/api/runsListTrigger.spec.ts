/**
 * The run LISTS must carry `trigger` — the field the actor mark renders.
 *
 * Same gap Phase 2 exposed: the extraction (triggerFromTrace) and the query are
 * each easy to cover, and neither proves they are WIRED. A column that never
 * reaches the mapper, or a mapper whose output never reaches the body, passes
 * both and ships a UI that silently shows nothing.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const USER = { id: "u1", email: "owner@example.com", created_at: "2026-06-01T00:00:00Z", tier: "scale", status: "active" };
const APP = { id: "a1", user_id: "u1", bundle_id: "com.x.app", name: "App", country: "US", created_at: "2026-06-01T00:00:00Z" };

const trace = (source: string | null) =>
  JSON.stringify(source ? { trigger: { source, reasons: ["2 targeted keyword(s) unranked"] } } : {});

function fakeDb(runRows: Array<Record<string, unknown>>) {
  const exec = (sql: string) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/FROM users WHERE (email|id) = \?/.test(s)) return { row: USER, rows: [] };
    if (/FROM apps WHERE id = \?/.test(s)) return { row: APP, rows: [APP] };
    if (/reasoning_json FROM runs WHERE app_id/.test(s)) return { row: runRows[0] ?? null, rows: runRows };
    if (/agent_run_count/.test(s)) return { row: null, rows: [] };
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

async function appDetail(runRows: Array<Record<string, unknown>>) {
  const res = await handleApi(
    new Request("https://api.test/apps/a1", { headers: { "X-User-Email": USER.email } }),
    env(fakeDb(runRows)),
    {} as ExecutionContext,
  );
  return (await res.json()) as { runs: Array<Record<string, unknown>> };
}

describe("GET /apps/:id carries each run's trigger", () => {
  it("surfaces an agent-opened run's trigger", async () => {
    const body = await appDetail([
      { id: "r1", status: "detected", created_at: "2026-08-17T09:00:00Z", reasoning_json: trace("cron") },
    ]);
    const t = body.runs[0]!.trigger as { source: string } | null;
    expect(t).toBeTruthy();
    expect(t!.source).toBe("cron");
  });

  it("a run whose trace carried no trigger reports null, not a default", async () => {
    const body = await appDetail([
      { id: "r2", status: "detected", created_at: "2026-08-17T09:00:00Z", reasoning_json: trace(null) },
    ]);
    expect(body.runs[0]!.trigger).toBeNull();
  });

  it("an unparseable trace reports null rather than 500ing the page", async () => {
    const body = await appDetail([
      { id: "r3", status: "detected", created_at: "2026-08-17T09:00:00Z", reasoning_json: "{not json" },
    ]);
    expect(body.runs[0]!.trigger).toBeNull();
  });

  it("does NOT leak the whole reasoning trace into the list", async () => {
    // The trace can be large and carries internals; only the resolved trigger
    // should cross the wire for a list view.
    const body = await appDetail([
      { id: "r4", status: "detected", created_at: "2026-08-17T09:00:00Z", reasoning_json: trace("cron") },
    ]);
    expect(body.runs[0]!.reasoning_json).toBeUndefined();
  });
});
