/**
 * The autopilot switches (migration 0017), through the REAL router:
 *   PATCH /account/asc-writes {optIn}   — consent to ASC writes
 *   PATCH /account/autopilot {execute}  — let the agent do approved runs' writes
 *   GET   /runs/:id/executions          — what it did
 * Autopilot cannot be turned on before the write consent is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let optIn = false;
let autopilot = false;
const runAutopilot = vi.fn(async () => ({ attempted: 0, shipped: 0 }));
vi.mock("../cron/autopilot.js", () => ({ runAutopilot }));
vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getAscWriteOptIn: async () => optIn,
    setAscWriteOptIn: async (_db: unknown, a: { optIn: boolean }) => { optIn = a.optIn; },
    getAutopilotExecute: async () => autopilot,
    setAutopilotExecute: async (_db: unknown, a: { execute: boolean }) => { autopilot = a.execute; },
    getRun: async (_db: unknown, id: string) => (id === "run-1" ? { id, app_id: "app-1", status: "shipped", created_at: "", reasoning_json: "{}" } : null),
    getApp: async () => ({ id: "app-1", user_id: "u1", bundle_id: "meme.snagg.app", name: "Snagg", country: "US" }),
    listRunExecutions: async () => [{ id: "e1", run_id: "run-1", step: "metadata", status: "done", detail: "pushed subtitle", created_at: "" }],
  };
});

const { handleApi } = await import("./index.js");

function fakeDb() {
  const user = { id: "u1", email: "u@e.com", created_at: "2026-01-01", tier: "startup", status: "active" };
  const stmt = { bind: () => stmt, first: async () => user, run: async () => ({ success: true, meta: { changes: 1 } }), all: async () => ({ results: [] }) };
  return { prepare: () => stmt } as never;
}
const env = { APP_ENV: "demo", DB: fakeDb() } as never;
const ctx = { waitUntil: vi.fn() } as never;

const call = (method: string, path: string, body?: unknown) =>
  handleApi(
    new Request(`https://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    ctx,
  );

beforeEach(() => {
  optIn = false;
  autopilot = false;
  runAutopilot.mockClear();
  (ctx as { waitUntil: ReturnType<typeof vi.fn> }).waitUntil.mockClear();
});

describe("autopilot switches", () => {
  it("refuses to turn autopilot on before the ASC-write consent is on", async () => {
    const res = await call("PATCH", "/account/autopilot", { execute: true });
    expect(res.status).toBe(403);
    expect(autopilot).toBe(false);
  });

  it("consent, then autopilot; turning it on kicks the executor for already-approved runs", async () => {
    expect((await call("PATCH", "/account/asc-writes", { optIn: true })).status).toBe(200);
    expect(optIn).toBe(true);
    const res = await call("PATCH", "/account/autopilot", { execute: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autopilot_execute: true });
    expect((ctx as { waitUntil: ReturnType<typeof vi.fn> }).waitUntil).toHaveBeenCalledTimes(1);
  });

  it("turning autopilot off never kicks the executor", async () => {
    optIn = true;
    autopilot = true;
    expect((await call("PATCH", "/account/autopilot", { execute: false })).status).toBe(200);
    expect(autopilot).toBe(false);
    expect((ctx as { waitUntil: ReturnType<typeof vi.fn> }).waitUntil).not.toHaveBeenCalled();
  });

  it("400s a non-boolean", async () => {
    expect((await call("PATCH", "/account/asc-writes", { optIn: "yes" })).status).toBe(400);
    expect((await call("PATCH", "/account/autopilot", { execute: 1 })).status).toBe(400);
  });

  it("/auth/me reports both switches", async () => {
    optIn = true;
    const me = (await (await call("GET", "/auth/me")).json()) as { asc_write_opt_in: boolean; autopilot_execute: boolean };
    expect(me).toMatchObject({ asc_write_opt_in: true, autopilot_execute: false });
  });

  it("GET /runs/:id/executions lists the steps for an owned run, 404s an unknown one", async () => {
    const res = await call("GET", "/runs/run-1/executions");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: "run-1", status: "shipped", executions: [{ step: "metadata", status: "done" }] });
    expect((await call("GET", "/runs/nope/executions")).status).toBe(404);
  });
});
