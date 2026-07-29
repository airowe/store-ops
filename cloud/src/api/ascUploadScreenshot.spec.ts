/**
 * POST /runs/:id/asc/upload-screenshot (#374) — driven through the REAL router.
 *
 * The gate logic is unit-tested in engine/ascWriteGate.spec.ts; this asserts the
 * route actually CONSULTS it. That distinction matters: a perfect gate nobody
 * calls is the same failure shape as #393's generated worker defining a helper
 * it never invoked, and the existing ASC write routes have no route-level tests
 * at all — `"approval required before"` appears only in index.ts.
 *
 * Egress is mocked, so no bytes reach Apple.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const uploadScreenshot = vi.fn(async () => ({
  ok: true as const,
  id: "shot-1",
  fileName: "APP_IPHONE_67_01.png",
  bytes: 4,
  checksum: "abc",
}));
vi.mock("../engine/ascUploadClient.js", () => ({ uploadScreenshot }));
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
    getRun: async () => ({
      id: "run-1",
      app_id: "app-1",
      status: runStatus,
      reasoning_json: "{}",
    }),
    getApp: async () => ({ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X" }),
    listAppsForUser: async () => [{ id: "app-1", user_id: "u1", bundle_id: "com.x.y", name: "X" }],
  };
});

vi.mock("./ascCredentials.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    // The stored-credential path (#67/#179) is exercised elsewhere; here it just
    // has to hand back a credential so the GATE is what the test is about.
    resolveAscCredential: async () => ({ p8: "k", keyId: "kid", issuerId: "iid" }),
  };
});

const { handleApi } = await import("./index.js");

/**
 * Minimal D1: auth resolves the user by email BEFORE the route runs, so an
 * empty DB 500s in `requireUser` and every assertion below would be about the
 * wrong thing. Only the user lookup/upsert needs to work — tier, opt-in, run
 * and app are mocked at the d1.js boundary above.
 */
function fakeDb() {
  const user = {
    id: "u1",
    email: "u@e.com",
    created_at: "2026-01-01",
    tier: "startup",
    status: "active",
  };
  const stmt = {
    bind: () => stmt,
    first: async () => user,
    run: async () => ({ success: true, meta: { changes: 1 } }),
    all: async () => ({ results: [] }),
  };
  return { prepare: () => stmt } as never;
}

const env = {
  APP_ENV: "demo",
  ASC_WRITE_ENABLED: "1",
  DB: fakeDb(),
} as never;

const post = (body: unknown) =>
  handleApi(
    new Request("https://api.test/runs/run-1/asc/upload-screenshot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      body: JSON.stringify(body),
    }),
    env,
    {} as never,
  );

const validBody = {
  screenshotSetId: "set-1",
  fileName: "APP_IPHONE_67_01.png",
  fileBase64: btoa("\x89PNG"),
};

beforeEach(() => {
  uploadScreenshot.mockClear();
  tier = "startup";
  optedIn = true;
  runStatus = "approved";
});

describe("POST /runs/:id/asc/upload-screenshot", () => {
  it("uploads when tier, opt-in, approval and the flag all hold", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(uploadScreenshot).toHaveBeenCalledTimes(1);
  });

  /**
   * The four blocks. Each must stop the upload BEFORE any bytes move — asserted
   * on the mock never being called, not merely on the status code.
   */
  it("402s a tier that cannot write, and uploads nothing", async () => {
    tier = "free";
    const res = await post(validBody);
    expect(res.status).toBe(402);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("403s a user who has not opted in, and uploads nothing", async () => {
    optedIn = false;
    const res = await post(validBody);
    expect(res.status).toBe(403);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("403s an unapproved run, and uploads nothing", async () => {
    runStatus = "awaiting_approval";
    const res = await post(validBody);
    expect(res.status).toBe(403);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("403s when the deployment flag is off, and uploads nothing", async () => {
    const res = await handleApi(
      new Request("https://api.test/runs/run-1/asc/upload-screenshot", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
        body: JSON.stringify(validBody),
      }),
      { ...(env as object), ASC_WRITE_ENABLED: "" } as never,
      {} as never,
    );
    expect(res.status).toBe(403);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("400s a missing screenshotSetId without uploading", async () => {
    const res = await post({ ...validBody, screenshotSetId: "" });
    expect(res.status).toBe(400);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("400s a missing fileName without uploading", async () => {
    const res = await post({ ...validBody, fileName: "" });
    expect(res.status).toBe(400);
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });

  it("passes the decoded bytes through, not the base64 string", async () => {
    await post(validBody);
    const arg = (uploadScreenshot.mock.calls[0] as unknown as [unknown, { file: Uint8Array }])[1];
    expect(arg.file).toBeInstanceOf(Uint8Array);
    expect(arg.file[0]).toBe(0x89); // PNG magic — decoded, not re-encoded text
  });
});
