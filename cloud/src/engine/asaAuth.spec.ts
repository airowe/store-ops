import { describe, expect, it } from "vitest";
import {
  AsaCredError,
  mintAsaClientSecret,
  mintAsaAccessToken,
  parseAsaBundle,
  serializeAsaBundle,
  verifyAsaCredentials,
  type AsaKeyBundle,
  type FetchLike,
} from "./asaAuth.js";

// A throwaway EC P-256 private key in PKCS#8 PEM (generated for this test only —
// not tied to any Apple account). Exercises the real ES256 signing path.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;

const BUNDLE: AsaKeyBundle = {
  privateKey: TEST_KEY,
  clientId: "SEARCHADS.0000-1111-2222",
  teamId: "SEARCHADS.0000-1111-2222",
  keyId: "abc-key-1",
  orgId: "9988776",
};

function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  return JSON.parse(json);
}

/** A minimal FetchLike returning a canned response, recording the last call. */
function fakeFetch(
  responder: (url: string, init: { method: string; body?: string }) => { ok?: boolean; status: number; body: string },
): { fn: FetchLike; calls: Array<{ url: string; method: string; body: string | undefined; headers: Record<string, string> | undefined }> } {
  const calls: Array<{ url: string; method: string; body: string | undefined; headers: Record<string, string> | undefined }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    const r = responder(url, init);
    return { ok: r.ok ?? (r.status >= 200 && r.status < 300), status: r.status, text: async () => r.body };
  };
  return { fn, calls };
}

describe("serializeAsaBundle / parseAsaBundle", () => {
  it("round-trips the bundle", () => {
    expect(parseAsaBundle(serializeAsaBundle(BUNDLE))).toEqual(BUNDLE);
  });
  it("rejects non-JSON", () => {
    expect(() => parseAsaBundle("nope")).toThrow(AsaCredError);
  });
  it("rejects a bundle missing a field", () => {
    const bad = JSON.stringify({ ...BUNDLE, orgId: "" });
    expect(() => parseAsaBundle(bad)).toThrow(/missing orgId/);
  });
});

describe("mintAsaClientSecret — ES256 client secret for the client-credentials grant", () => {
  it("produces a three-segment JWT", async () => {
    const jwt = await mintAsaClientSecret(BUNDLE);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("header carries alg=ES256 and the key id", async () => {
    const header = decodeSegment((await mintAsaClientSecret(BUNDLE)).split(".")[0]!);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(BUNDLE.keyId);
  });

  it("claims: sub=clientId, iss=teamId, aud=appleid, bounded exp", async () => {
    const now = 1_700_000_000;
    const claims = decodeSegment((await mintAsaClientSecret(BUNDLE, { now })).split(".")[1]!);
    expect(claims.sub).toBe(BUNDLE.clientId);
    expect(claims.iss).toBe(BUNDLE.teamId);
    expect(claims.aud).toBe("https://appleid.apple.com");
    expect(claims.iat).toBe(now);
    expect((claims.exp as number) - now).toBeGreaterThan(0);
    expect((claims.exp as number) - now).toBeLessThanOrEqual(180 * 24 * 60 * 60);
  });

  it("rejects a bundle with no private key without leaking anything", async () => {
    await expect(mintAsaClientSecret({ ...BUNDLE, privateKey: "" })).rejects.toThrow(AsaCredError);
  });
});

describe("mintAsaAccessToken — exchange at appleid.apple.com", () => {
  it("POSTs the client-credentials grant and returns the access token", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: JSON.stringify({ access_token: "tok-123", expires_in: 3600 }) }));
    const out = await mintAsaAccessToken(fn, BUNDLE);
    expect(out.accessToken).toBe("tok-123");
    expect(out.expiresIn).toBe(3600);
    expect(calls[0]!.url).toBe("https://appleid.apple.com/auth/oauth2/token");
    const body = calls[0]!.body!;
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("scope=searchadsorg");
    expect(body).toContain(`client_id=${encodeURIComponent(BUNDLE.clientId)}`);
    // the client_secret in the body IS a three-segment JWT
    const secret = new URLSearchParams(body).get("client_secret")!;
    expect(secret.split(".")).toHaveLength(3);
  });

  it("non-2xx → AsaCredError (no key material)", async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: "unauthorized" }));
    await expect(mintAsaAccessToken(fn, BUNDLE)).rejects.toThrow(/HTTP 401/);
  });

  it("non-JSON body → AsaCredError", async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: "<html>" }));
    await expect(mintAsaAccessToken(fn, BUNDLE)).rejects.toThrow(/non-JSON/);
  });

  it("missing access_token → AsaCredError", async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: JSON.stringify({ token_type: "Bearer" }) }));
    await expect(mintAsaAccessToken(fn, BUNDLE)).rejects.toThrow(/no access_token/);
  });
});

describe("verifyAsaCredentials — mint + /acls org reachability", () => {
  const tokenOk = { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 3600 }) };

  it("ok when /acls lists the claimed org", async () => {
    const { fn } = fakeFetch((url) =>
      url.includes("/acls")
        ? { status: 200, body: JSON.stringify({ data: [{ orgId: 9988776, orgName: "X" }] }) }
        : tokenOk,
    );
    expect(await verifyAsaCredentials(fn, BUNDLE)).toEqual({ ok: true });
  });

  it("not ok when the org is not among the token's ACLs", async () => {
    const { fn } = fakeFetch((url) =>
      url.includes("/acls") ? { status: 200, body: JSON.stringify({ data: [{ orgId: 1 }] }) } : tokenOk,
    );
    const r = await verifyAsaCredentials(fn, BUNDLE);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("9988776");
  });

  it("not ok on a 403 from /acls", async () => {
    const { fn } = fakeFetch((url) => (url.includes("/acls") ? { status: 403, body: "" } : tokenOk));
    const r = await verifyAsaCredentials(fn, BUNDLE);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("403");
  });

  it("not ok (honest reason) when the token mint itself fails", async () => {
    const { fn } = fakeFetch(() => ({ status: 400, body: "bad" }));
    const r = await verifyAsaCredentials(fn, BUNDLE);
    expect(r.ok).toBe(false);
    // reason is the key-free AsaCredError message, never key material
    expect((r as { reason: string }).reason).not.toContain("PRIVATE KEY");
  });
});
