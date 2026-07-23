import { describe, it, expect } from "vitest";
import {
  parseKeyIdFromFilename,
  looksLikeEcPrivateKey,
  normalizeP8,
  parseKeyBundleJson,
} from "./ascKeyFile.js";

// A real, structurally-valid P-256 PKCS#8 key (test fixture — not a live Apple key).
const REAL_P8 = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2",
  "OF/2NxApJCzGCEDdfSp6VQO3o8fhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r",
  "1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("parseKeyIdFromFilename", () => {
  it("extracts the Key ID from Apple's AuthKey_<ID>.p8 pattern", () => {
    expect(parseKeyIdFromFilename("AuthKey_ABC123.p8")).toBe("ABC123");
    expect(parseKeyIdFromFilename("AuthKey_2X9.p8")).toBe("2X9");
  });
  it("returns null for a renamed or non-matching filename", () => {
    expect(parseKeyIdFromFilename("mykey.p8")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_.p8")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_ABC.pem")).toBeNull();
    expect(parseKeyIdFromFilename("AuthKey_ABC 123.p8")).toBeNull();
  });
});

describe("looksLikeEcPrivateKey", () => {
  it("accepts a real P-256 PKCS#8 PEM", () => {
    expect(looksLikeEcPrivateKey(REAL_P8)).toBe(true);
  });
  it("rejects a wrong file, empty input, and encrypted PKCS#8", () => {
    expect(looksLikeEcPrivateKey("not a key at all")).toBe(false);
    expect(looksLikeEcPrivateKey("")).toBe(false);
    expect(
      looksLikeEcPrivateKey(
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----",
      ),
    ).toBe(false);
  });
  it("rejects a header whose body is not valid base64", () => {
    expect(
      looksLikeEcPrivateKey(
        "-----BEGIN PRIVATE KEY-----\n!!!not base64!!!\n-----END PRIVATE KEY-----",
      ),
    ).toBe(false);
  });
});

describe("normalizeP8", () => {
  it("strips exactly one trailing newline and leaves the interior intact", () => {
    expect(normalizeP8("a\nb\n")).toBe("a\nb");
    expect(normalizeP8("a\nb")).toBe("a\nb");
    expect(normalizeP8("a\nb\n\n")).toBe("a\nb\n");
  });
});

describe("parseKeyBundleJson", () => {
  const teamBundle = JSON.stringify({
    key_id: "D383SF739",
    issuer_id: "6053b7fe-68a8-4acb-89be-165aa6465141",
    key: REAL_P8,
  });

  it("parses a Fastlane team bundle into all three fields", () => {
    const r = parseKeyBundleJson(teamBundle);
    expect(r).toEqual({
      ok: true,
      bundle: { keyId: "D383SF739", issuerId: "6053b7fe-68a8-4acb-89be-165aa6465141", key: REAL_P8 },
    });
  });

  it("treats a missing issuer_id (individual key) as issuerId null, not an error", () => {
    const r = parseKeyBundleJson(JSON.stringify({ key_id: "K1", key: REAL_P8 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.issuerId).toBeNull();
  });

  it("treats issuer_id null, empty-string, and whitespace-only all as issuerId null", () => {
    for (const issuer_id of [null, "", "   "]) {
      const r = parseKeyBundleJson(JSON.stringify({ key_id: "K1", issuer_id, key: REAL_P8 }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.bundle.issuerId).toBeNull();
    }
  });

  it("decodes key when is_key_content_base64 is true", () => {
    const b64 = btoa(REAL_P8);
    const r = parseKeyBundleJson(
      JSON.stringify({ key_id: "K1", issuer_id: "I1", key: b64, is_key_content_base64: true }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.key).toBe(REAL_P8);
  });

  it("rejects a bundle missing key_id or key", () => {
    expect(parseKeyBundleJson(JSON.stringify({ issuer_id: "I1", key: REAL_P8 })).ok).toBe(false);
    expect(parseKeyBundleJson(JSON.stringify({ key_id: "K1", issuer_id: "I1" })).ok).toBe(false);
  });

  it("rejects when key is present but not an EC private key", () => {
    expect(parseKeyBundleJson(JSON.stringify({ key_id: "K1", key: "nope" })).ok).toBe(false);
  });

  it("rejects non-JSON text", () => {
    expect(parseKeyBundleJson("not json at all").ok).toBe(false);
    expect(parseKeyBundleJson("").ok).toBe(false);
  });

  it("rejects is_key_content_base64 true when key does not decode to a valid key", () => {
    const r = parseKeyBundleJson(
      JSON.stringify({ key_id: "K1", key: "!!!not base64!!!", is_key_content_base64: true }),
    );
    expect(r.ok).toBe(false);
  });
});
