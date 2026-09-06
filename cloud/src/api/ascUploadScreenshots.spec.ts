/**
 * POST /runs/:id/asc/upload-screenshots (#374) — the strip lane, through the
 * REAL router. The batch engine is unit-tested in engine/ascScreenshotBatch.spec.ts;
 * this asserts the route consults the gate, resolves the locale, decodes the
 * files, and hands the batch exactly what it was given. Egress is mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const uploadScreenshotBatch = vi.fn(async (_f: unknown, input: { shots: { fileName: string; file: Uint8Array }[]; locale: string; bundleId: string; displayType: string }) => ({
  ok: true,
  appId: "6757125366",
  version: { id: "v-edit", versionString: "1.0.1", state: "PREPARE_FOR_SUBMISSION" },
  localizationId: "loc-en",
  screenshotSetId: "set-1",
  setCreated: false,
  uploaded: input.shots.map((s, i) => ({ fileName: s.fileName, id: `id-${i}`, bytes: s.file.length, checksum: "c", parts: 1 })),
  skipped: [],
  remaining: [],
}));
vi.mock("../engine/ascScreenshotBatch.js", () => ({ uploadScreenshotBatch }));
vi.mock("../engine/ascJwt.js", () => ({ mintAscJwt: async () => "tok" }));

let tier = "startup";
let optedIn = true;
let runStatus = "approved";
let country = "DE";

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getTier: async () => tier,
    getAscWriteOptIn: async () => optedIn,
    getRun: async () => ({ id: "run-1", app_id: "app-1", status: runStatus, reasoning_json: "{}" }),
    getApp: async () => ({ id: "app-1", user_id: "u1", bundle_id: "meme.snagg.app", name: "Snagg", country }),
    listAppsForUser: async () => [{ id: "app-1", user_id: "u1", bundle_id: "meme.snagg.app", name: "Snagg", country }],
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

const env = { APP_ENV: "demo", ASC_WRITE_ENABLED: "1", DB: fakeDb() } as never;

const post = (body: unknown, e = env) =>
  handleApi(
    new Request("https://api.test/runs/run-1/asc/upload-screenshots", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      body: JSON.stringify(body),
    }),
    e,
    {} as never,
  );

const validBody = {
  screenshotDisplayType: "APP_IPHONE_67",
  shots: [
    { fileName: "01_home.png", fileBase64: btoa("\x89PNG-1") },
    { fileName: "02_detail.png", fileBase64: btoa("\x89PNG-22") },
  ],
};

beforeEach(() => {
  uploadScreenshotBatch.mockClear();
  tier = "startup";
  optedIn = true;
  runStatus = "approved";
  country = "DE";
});

describe("POST /runs/:id/asc/upload-screenshots", () => {
  it("uploads the strip when tier, opt-in, approval and the flag hold; locale defaults to the storefront", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; uploaded: { fileName: string; bytes: number }[] };
    expect(body.ok).toBe(true);
    expect(body.uploaded.map((u) => u.fileName)).toEqual(["01_home.png", "02_detail.png"]);
    expect(body.uploaded[1]!.bytes).toBe(7);
    expect(uploadScreenshotBatch).toHaveBeenCalledTimes(1);
    const input = uploadScreenshotBatch.mock.calls[0]![1];
    expect(input).toMatchObject({ bundleId: "meme.snagg.app", locale: "de-DE", displayType: "APP_IPHONE_67" });
    expect(input.shots.map((s) => s.fileName)).toEqual(["01_home.png", "02_detail.png"]);
  });

  it("an explicit locale wins over the storefront default", async () => {
    await post({ ...validBody, locale: "en-US" });
    expect(uploadScreenshotBatch.mock.calls[0]![1].locale).toBe("en-US");
  });

  it("400s without a display type or without shots, and uploads nothing", async () => {
    expect((await post({ shots: validBody.shots })).status).toBe(400);
    expect((await post({ screenshotDisplayType: "APP_IPHONE_67", shots: [] })).status).toBe(400);
    expect((await post({ screenshotDisplayType: "APP_IPHONE_67", shots: [{ fileBase64: "aGk=" }] })).status).toBe(400);
    expect(uploadScreenshotBatch).not.toHaveBeenCalled();
  });

  it("402s a tier that cannot write, 403s no opt-in, 403s an unapproved run — nothing moves", async () => {
    tier = "free";
    expect((await post(validBody)).status).toBe(402);
    tier = "startup";
    optedIn = false;
    expect((await post(validBody)).status).toBe(403);
    optedIn = true;
    runStatus = "awaiting_approval";
    expect((await post(validBody)).status).toBe(403);
    expect(uploadScreenshotBatch).not.toHaveBeenCalled();
  });

  it("403s when the deployment flag is off", async () => {
    const res = await post(validBody, { APP_ENV: "demo", ASC_WRITE_ENABLED: "0", DB: fakeDb() } as never);
    expect(res.status).toBe(403);
    expect(uploadScreenshotBatch).not.toHaveBeenCalled();
  });

  it("returns a refusal from the engine as {ok:false, reason}, not a 500", async () => {
    const { AscWriteError } = await import("../engine/ascWrite.js");
    uploadScreenshotBatch.mockRejectedValueOnce(new AscWriteError("No editable App Store version found."));
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "No editable App Store version found." });
  });
});
