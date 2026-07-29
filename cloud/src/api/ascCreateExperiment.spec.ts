/**
 * POST /runs/:id/asc/create-experiment (#374) — driven through the REAL router.
 *
 * This route can change what real App Store visitors see, so the assertions are
 * about what STOPS it: its own flag, the shared gate, and a live test.
 *
 * The engine's rules (never send `started`, refuse while one is running) are
 * unit-tested in engine/ascExperimentCreate.spec.ts; here the claim is that the
 * route consults the gate and its own switch at all.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const createPpoExperiment = vi.fn(async () => ({
  ok: true as const,
  id: "exp-1",
  name: "Outcome-led shots",
  started: false,
  state: "PREPARE_FOR_SUBMISSION",
}));
vi.mock("../engine/ascExperimentCreate.js", () => ({ createPpoExperiment }));
vi.mock("../engine/ascExperiments.js", () => ({ readAscExperiments: async () => ({ experiments: [] }) }));
vi.mock("../engine/ascWrite.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, findAscAppId: async () => "123456" };
});
vi.mock("../engine/ascJwt.js", () => ({ mintAscJwt: async () => "tok" }));

let tier = "startup";
let optedIn = true;
let runStatus = "approved";

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getTier: async () => tier,
    getAscWriteOptIn: async () => optedIn,
    getRun: async () => ({ id: "run-1", app_id: "app-1", status: runStatus, reasoning_json: "{}" }),
    getApp: async () => ({ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X" }),
    listAppsForUser: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X" }],
  };
});

vi.mock("./ascCredentials.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, resolveAscCredential: async () => ({ p8: "k", keyId: "kid", issuerId: "iid" }) };
});

const { handleApi } = await import("./index.js");

function fakeDb() {
  const user = { id: "u1", email: "u@e.com", created_at: "2026-01-01", tier: "startup", status: "active" };
  const stmt = {
    bind: () => stmt,
    first: async () => user,
    run: async () => ({ success: true, meta: { changes: 1 } }),
    all: async () => ({ results: [] }),
  };
  return { prepare: () => stmt } as never;
}

const baseEnv = {
  APP_ENV: "demo",
  ASC_WRITE_ENABLED: "1",
  ASC_EXPERIMENT_WRITE_ENABLED: "1",
  DB: fakeDb(),
};

const body = { appStoreVersionId: "ver-1", name: "Outcome-led shots", trafficProportion: 50 };

const post = (env: Record<string, unknown> = baseEnv, b: unknown = body) =>
  handleApi(
    new Request("https://api.test/runs/run-1/asc/create-experiment", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      body: JSON.stringify(b),
    }),
    env as never,
    {} as never,
  );

beforeEach(() => {
  createPpoExperiment.mockClear();
  tier = "startup";
  optedIn = true;
  runStatus = "approved";
});

describe("POST /runs/:id/asc/create-experiment", () => {
  it("creates when both flags, tier, opt-in and approval hold", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(createPpoExperiment).toHaveBeenCalledTimes(1);
  });

  /**
   * Its OWN switch. A deployment that allows metadata writes has NOT thereby
   * allowed splitting live traffic — that is the whole reason for a second flag.
   */
  it("403s when the experiment flag is off even though ASC writes are enabled", async () => {
    const res = await post({ ...baseEnv, ASC_EXPERIMENT_WRITE_ENABLED: "" });
    expect(res.status).toBe(403);
    expect(createPpoExperiment).not.toHaveBeenCalled();
  });

  it("402s a tier that cannot write", async () => {
    tier = "free";
    expect((await post()).status).toBe(402);
    expect(createPpoExperiment).not.toHaveBeenCalled();
  });

  it("403s a user who has not opted in", async () => {
    optedIn = false;
    expect((await post()).status).toBe(403);
    expect(createPpoExperiment).not.toHaveBeenCalled();
  });

  it("403s an unapproved run", async () => {
    runStatus = "awaiting_approval";
    expect((await post()).status).toBe(403);
    expect(createPpoExperiment).not.toHaveBeenCalled();
  });

  it("400s a missing appStoreVersionId without calling Apple", async () => {
    const res = await post(baseEnv, { ...body, appStoreVersionId: "" });
    expect(res.status).toBe(400);
    expect(createPpoExperiment).not.toHaveBeenCalled();
  });

  /**
   * The live-state read must feed the engine's refusal. Passing stale or empty
   * data would let a second experiment be created while one is running.
   */
  it("passes the CURRENTLY read experiments to the engine", async () => {
    await post();
    const arg = (createPpoExperiment.mock.calls[0] as unknown as [unknown, { runningExperiments: unknown }])[1];
    expect(arg.runningExperiments).toEqual([]);
  });
});
