import { describe, it, expect } from "vitest";
import {
  parseKeyIdFromFilename,
  looksLikeEcPrivateKey,
  normalizeP8,
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
