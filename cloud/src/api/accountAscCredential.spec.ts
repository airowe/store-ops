/**
 * POST /account/credentials/asc (#374) — one team-scoped ASC key for every app,
 * through the REAL router. The key must mint AND be accepted by Apple on a
 * read before anything is saved; the response never carries the p8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveCredential = vi.fn(async (_env: unknown, args: { userId: string; appId: string | null; kind: string; keyId: string; issuerId: string }) => ({
  id: "cred-1",
  appId: args.appId,
  kind: args.kind,
  keyId: args.keyId,
  issuerId: args.issuerId,
  createdAt: "2026-09-06",
  lastUsedAt: null,
}));
let enabled = true;
vi.mock("../credentialStore.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, saveCredential, credentialsEnabled: () => enabled };
});

let mintOk = true;
vi.mock("../engine/ascJwt.js", () => ({
  mintAscJwt: async () => {
    if (!mintOk) throw new Error("p8 is not a valid PKCS#8 key");
    return "tok";
  },
}));

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

const env = { APP_ENV: "demo", DB: fakeDb() } as never;
const trio = { p8: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", keyId: "NC235A8728", issuerId: "166b49fe-7da6-45ec-b392-0aa2f5d391a2" };

const post = (body: unknown) =>
  handleApi(
    new Request("https://api.test/account/credentials/asc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-email": "u@e.com" },
      body: JSON.stringify(body),
    }),
    env,
    {} as never,
  );

let probeStatus = 200;
const realFetch = globalThis.fetch;
beforeEach(() => {
  saveCredential.mockClear();
  enabled = true;
  mintOk = true;
  probeStatus = 200;
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("appstoreconnect.apple.com/v1/apps")) return new Response("{}", { status: probeStatus });
    return new Response("{}", { status: 500 });
  }) as never;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /account/credentials/asc", () => {
  it("saves the key account-wide (appId null) after Apple accepts it on a read, and returns metadata only", async () => {
    const res = await post(trio);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; credential: { appId: string | null; keyId: string } };
    expect(body.ok).toBe(true);
    expect(body.credential).toMatchObject({ appId: null, keyId: "NC235A8728" });
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
    expect(saveCredential).toHaveBeenCalledTimes(1);
    expect(saveCredential.mock.calls[0]![1]).toMatchObject({ userId: "u1", appId: null, kind: "asc" });
  });

  it("400s an incomplete trio and saves nothing", async () => {
    expect((await post({ p8: trio.p8, keyId: trio.keyId })).status).toBe(400);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400s a key that cannot mint, and saves nothing", async () => {
    mintOk = false;
    expect((await post(trio)).status).toBe(400);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400s a key Apple rejects on the read probe, and saves nothing — a key that does not work is never stored", async () => {
    probeStatus = 401;
    const res = await post(trio);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/rejected.*401/);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400s when stored credentials are not enabled on the deployment", async () => {
    enabled = false;
    expect((await post(trio)).status).toBe(400);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("401s without a user", async () => {
    const res = await handleApi(
      new Request("https://api.test/account/credentials/asc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(trio) }),
      env,
      {} as never,
    );
    expect(res.status).toBe(401);
  });
});
