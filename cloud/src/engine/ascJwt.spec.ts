import { describe, expect, it } from "vitest";
import { mintAscJwt, parseP8, AscCredError } from "./ascJwt.js";

// A throwaway EC P-256 private key in PKCS#8 PEM (generated for this test only —
// not tied to any Apple account). Used to exercise the real ES256 signing path.
const TEST_P8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;

const KEY_ID = "ABC123DEFG";
const ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a";

function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  return JSON.parse(json);
}

describe("parseP8 — accept a .p8 in PEM or raw-base64 form", () => {
  it("strips PEM armor + whitespace and returns the DER bytes", async () => {
    const der = parseP8(TEST_P8);
    expect(der).toBeInstanceOf(Uint8Array);
    expect(der.length).toBeGreaterThan(0);
  });

  it("accepts the inner base64 without the BEGIN/END armor", () => {
    const inner = TEST_P8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(() => parseP8(inner)).not.toThrow();
  });

  it("throws AscCredError on obvious garbage", () => {
    expect(() => parseP8("not a key")).toThrow(AscCredError);
  });
});

describe("mintAscJwt — ES256 token for the App Store Connect API", () => {
  it("produces a three-segment JWT", async () => {
    const jwt = await mintAscJwt({ p8: TEST_P8, keyId: KEY_ID, issuerId: ISSUER_ID });
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("sets the ES256 header with the key id and JWT type", async () => {
    const jwt = await mintAscJwt({ p8: TEST_P8, keyId: KEY_ID, issuerId: ISSUER_ID });
    const header = decodeSegment(jwt.split(".")[0]!);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(KEY_ID);
    expect(header.typ).toBe("JWT");
  });

  it("sets iss=issuerId, aud=appstoreconnect-v1, and a bounded exp", async () => {
    const now = 1_700_000_000; // fixed clock, injected
    const jwt = await mintAscJwt({
      p8: TEST_P8,
      keyId: KEY_ID,
      issuerId: ISSUER_ID,
      now,
    });
    const claims = decodeSegment(jwt.split(".")[1]!);
    expect(claims.iss).toBe(ISSUER_ID);
    expect(claims.aud).toBe("appstoreconnect-v1");
    expect(claims.iat).toBe(now);
    // Apple rejects tokens with exp > 20 min out; keep a safe margin.
    expect((claims.exp as number) - now).toBeGreaterThan(0);
    expect((claims.exp as number) - now).toBeLessThanOrEqual(20 * 60);
  });

  it("yields a non-empty signature segment", async () => {
    const jwt = await mintAscJwt({ p8: TEST_P8, keyId: KEY_ID, issuerId: ISSUER_ID });
    const sig = jwt.split(".")[2]!;
    expect(sig.length).toBeGreaterThan(0);
    // base64url — no '+' '/' '=' padding
    expect(sig).not.toMatch(/[+/=]/);
  });

  it("rejects a missing/blank key id or issuer id", async () => {
    await expect(
      mintAscJwt({ p8: TEST_P8, keyId: "", issuerId: ISSUER_ID }),
    ).rejects.toThrow(AscCredError);
    await expect(
      mintAscJwt({ p8: TEST_P8, keyId: KEY_ID, issuerId: "  " }),
    ).rejects.toThrow(AscCredError);
  });

  it("rejects a malformed .p8 with a typed error (never leaks the key bytes)", async () => {
    await expect(
      mintAscJwt({ p8: "-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----", keyId: KEY_ID, issuerId: ISSUER_ID }),
    ).rejects.toThrow(AscCredError);
  });
});
