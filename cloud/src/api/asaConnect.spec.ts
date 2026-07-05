/**
 * POST /account/asa-credential (#78-2) — connect + VERIFY an Apple Search Ads
 * key before storing it. Driven through the real `handleApi` router. The network
 * (token exchange + /acls) is mocked via `fetchForEnv`; the credential store is
 * mocked so we assert the glue (gate, validation, verify-reject, and that a
 * verified key is saved as kind:"asa" with the serialized bundle). The real
 * `verifyAsaCredentials` + ES256 signing run against the fake transport.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── mock the egress: token exchange then /acls ──────────────────────────────
let acls: unknown = { data: [{ orgId: 77 }] };
let tokenStatus = 200;
const fetchImpl = vi.fn(async (url: string) => {
  if (url.includes("/auth/oauth2/token")) {
    return { ok: tokenStatus >= 200 && tokenStatus < 300, status: tokenStatus, text: async () => JSON.stringify({ access_token: "tok", expires_in: 3600 }) };
  }
  if (url.includes("/acls")) {
    return { ok: true, status: 200, text: async () => JSON.stringify(acls) };
  }
  return { ok: false, status: 404, text: async () => "" };
});
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => fetchImpl }));

// ── mock the credential store (avoid a real DB; assert the save call) ─────────
let kekSet = true;
const saveCredential = vi.fn(async (_env: unknown, args: { kind: string; keyId: string; issuerId: string }) => ({
  id: "cred-1", appId: null, kind: args.kind, keyId: args.keyId, issuerId: args.issuerId,
  createdAt: "2026-07-05T00:00:00Z", lastUsedAt: null, kekVersion: 1,
}));
vi.mock("../credentialStore.js", () => ({
  credentialsEnabled: () => kekSet,
  saveCredential: (...a: unknown[]) => saveCredential(...(a as [unknown, { kind: string; keyId: string; issuerId: string }])),
  deleteCredential: vi.fn(async () => true),
  listCredentialMeta: vi.fn(async () => []),
  useCredential: vi.fn(async () => null),
}));

import { handleApi } from "./index.js";
import type { Env } from "../index.js";
import { parseAsaBundle } from "../engine/asaAuth.js";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;

const GOOD = { privateKey: TEST_KEY, clientId: "SEARCHADS.abc", teamId: "SEARCHADS.abc", keyId: "key-1", orgId: "77" };

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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { DB: fakeUsersDb(), DEFAULT_COUNTRY: "US", APP_ENV: "demo", CRED_KEK_V1: "x", ...overrides } as Env;
}

const EMAIL = "owner@example.com";
function req(body: unknown, opts: { email?: string } = { email: EMAIL }): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.email) headers["x-user-email"] = opts.email;
  return new Request("https://api.test/account/asa-credential", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  acls = { data: [{ orgId: 77 }] };
  tokenStatus = 200;
  kekSet = true;
});

describe("POST /account/asa-credential", () => {
  it("verifies then stores a good key as kind:asa (bundle serialized, orgId as issuer)", async () => {
    const res = await handleApi(req(GOOD), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credential: { kind: string; keyId: string; issuerId: string }; popularityLive: boolean; note: string };
    expect(body.credential.kind).toBe("asa");
    expect(body.credential.keyId).toBe("key-1");
    expect(body.credential.issuerId).toBe("77");
    expect(body.popularityLive).toBe(false); // ASA_POPULARITY_ENABLED unset → dark
    expect(body.note).toMatch(/verifying the Search Ads read/i);

    // saved the whole bundle as one envelope
    expect(saveCredential).toHaveBeenCalledTimes(1);
    const arg = saveCredential.mock.calls[0]![1];
    expect(parseAsaBundle((arg as unknown as { plaintext: string }).plaintext)).toEqual(GOOD);
  });

  it("popularityLive true + live note when ASA_POPULARITY_ENABLED is set", async () => {
    const res = await handleApi(req(GOOD), makeEnv({ ASA_POPULARITY_ENABLED: "1" }));
    const body = (await res.json()) as { popularityLive: boolean; note: string };
    expect(body.popularityLive).toBe(true);
    expect(body.note).toMatch(/real search popularity/i);
  });

  it("503 when credential storage is not enabled (no KEK)", async () => {
    kekSet = false; // credentialsEnabled() is mocked off, regardless of env KEK
    const res = await handleApi(req(GOOD), makeEnv());
    expect(res.status).toBe(503);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400 on a missing field, before any verify/store", async () => {
    const res = await handleApi(req({ ...GOOD, orgId: "" }), makeEnv());
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400 (not stored) when Apple has no access to the claimed org", async () => {
    acls = { data: [{ orgId: 999 }] }; // token valid, but org 77 not reachable
    const res = await handleApi(req(GOOD), makeEnv());
    expect(res.status).toBe(400);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("400 (not stored) when Apple rejects the token", async () => {
    tokenStatus = 401;
    const res = await handleApi(req(GOOD), makeEnv());
    expect(res.status).toBe(400);
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it("401 without a user (auth-gated)", async () => {
    const res = await handleApi(req(GOOD, {}), makeEnv());
    expect(res.status).toBe(401);
  });
});
