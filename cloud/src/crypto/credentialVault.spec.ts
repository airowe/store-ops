import { describe, expect, it } from "vitest";
import {
  importKek,
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
