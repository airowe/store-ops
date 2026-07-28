import { describe, expect, it } from "vitest";
import {
  importKek,
  kekFingerprint,
  openCredential,
  rewrapDek,
  sealCredential,
  type VaultContext,
} from "./credentialVault.js";

/**
 * Credential vault (#67) — the envelope-encryption invariants from the design:
 * round-trip, one-DEK-per-seal (fresh IVs + fresh wrapped DEK each time), AAD
 * anti-transplant on both layers, tamper detection, and lossless KEK rotation.
 */

// two distinct 32-byte KEKs (base64)
const KEK_A = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const KEK_B = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 200 - i)));

const CTX: VaultContext = { userId: "u1", appId: "app1", kind: "asc", kekVersion: 1 };
const P8 = "-----BEGIN PRIVATE KEY-----\nMIIabc...\n-----END PRIVATE KEY-----";

describe("credentialVault envelope", () => {
  it("round-trips a credential under the right KEK + context", async () => {
    const kek = await importKek(KEK_A);
    const sealed = await sealCredential(kek, P8, CTX);
    expect(sealed.kekVersion).toBe(1);
    expect(await openCredential(kek, sealed, CTX)).toBe(P8);
  });

  it("persists NO plaintext or key material in the envelope", async () => {
    const kek = await importKek(KEK_A);
    const sealed = await sealCredential(kek, P8, CTX);
    const blob = JSON.stringify(sealed);
    expect(blob).not.toContain("PRIVATE KEY");
    expect(blob).not.toContain("MIIabc");
  });

  it("ONE DEK PER SEAL: sealing the same input twice yields different envelopes", async () => {
    const kek = await importKek(KEK_A);
    const a = await sealCredential(kek, P8, CTX);
    const b = await sealCredential(kek, P8, CTX);
    // fresh DEK + fresh IVs each time → no field collides (no nonce reuse ever)
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it("the WRONG KEK cannot open it", async () => {
    const kekA = await importKek(KEK_A);
    const kekB = await importKek(KEK_B);
    const sealed = await sealCredential(kekA, P8, CTX);
    await expect(openCredential(kekB, sealed, CTX)).rejects.toBeTruthy();
  });

  it("AAD: a ciphertext transplanted to another user/app/kind fails to decrypt", async () => {
    const kek = await importKek(KEK_A);
    const sealed = await sealCredential(kek, P8, CTX);
    await expect(openCredential(kek, sealed, { ...CTX, userId: "u2" })).rejects.toBeTruthy();
    await expect(openCredential(kek, sealed, { ...CTX, appId: "app2" })).rejects.toBeTruthy();
    await expect(openCredential(kek, sealed, { ...CTX, kind: "play" })).rejects.toBeTruthy();
  });

  it("TAMPER: flipping a byte of the ciphertext is detected (GCM tag)", async () => {
    const kek = await importKek(KEK_A);
    const sealed = await sealCredential(kek, P8, CTX);
    const bad = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith("A") ? "B" : "A") + "=" };
    await expect(openCredential(kek, bad, CTX)).rejects.toBeTruthy();
  });

  it("a malformed KEK (wrong length) fails loudly at import", async () => {
    await expect(importKek(btoa("too short"))).rejects.toThrow(/32 bytes/);
  });

  it("ROTATION: rewrap under a new KEK keeps the plaintext; old KEK no longer opens it", async () => {
    const kekV1 = await importKek(KEK_A);
    const kekV2 = await importKek(KEK_B);
    const sealed = await sealCredential(kekV1, P8, CTX);

    const rotated = await rewrapDek(kekV1, kekV2, sealed, { userId: "u1", appId: "app1", kind: "asc" }, 2);
    expect(rotated.kekVersion).toBe(2);
    expect(await openCredential(kekV2, rotated, CTX)).toBe(P8); // opens under v2 + ctx(v2 coalesced)
    // the rotated envelope is NOT openable with the old KEK
    await expect(openCredential(kekV1, rotated, CTX)).rejects.toBeTruthy();
  });
});

/**
 * #372 — KEK fingerprints. The incident: CRED_KEK_V1 was REPLACED with a new
 * value rather than a new version being added as V2, which silently orphaned
 * every stored credential. Nothing detected it, because a wrong-but-present KEK
 * is indistinguishable from the right one until a decrypt fails.
 *
 * A fingerprint stored beside each row makes the mismatch identifiable BEFORE
 * any decryption is attempted — and, more importantly, lets the system say
 * "this row was sealed under a different key" instead of "decrypt failed".
 */
describe("kekFingerprint (#372)", () => {
  it("is stable for the same key and differs for a different one", async () => {
    const a1 = await kekFingerprint(KEK_A);
    const a2 = await kekFingerprint(KEK_A);
    const b = await kekFingerprint(KEK_B);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  /**
   * The security property that matters: the fingerprint is stored in D1, so a
   * database leak must not help an attacker recover or verify-guess the KEK.
   * It is a SALTED hash with a fixed domain-separation label, never the key
   * itself and never a bare digest of it.
   */
  it("never contains the key material, and is not a bare digest of it", async () => {
    const fp = await kekFingerprint(KEK_A);
    expect(fp).not.toContain(KEK_A);
    // a bare SHA-256 of the base64 string would be trivially checkable against
    // a candidate list; ours is domain-separated, so it must differ from it
    const bare = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEK_A));
    const bareHex = [...new Uint8Array(bare)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(fp).not.toBe(bareHex);
  });

  it("is short enough to store and log without being the secret", async () => {
    const fp = await kekFingerprint(KEK_A);
    // 16 hex chars = 64 bits: ample to distinguish a handful of KEKs, far too
    // short to be useful as a verification oracle for brute force.
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects a malformed KEK rather than fingerprinting garbage", async () => {
    await expect(kekFingerprint("not-base64-32-bytes")).rejects.toThrow();
  });
});
