/**
 * RLHF-at-rest crypto (#39 Part 2). Proposal-edit values are NEVER stored in
 * plaintext — they are AES-256-GCM encrypted with a per-row random 12-byte IV,
 * keyed by a base64 32-byte key from env.RLHF_ENCRYPTION_KEY. The stored blob is
 * base64(IV ++ ciphertext+tag).
 *
 * Pinned here:
 *   • round-trip: decrypt(encrypt(x)) === x (incl. unicode + empty string),
 *   • a fresh random IV per call ⇒ two encryptions of the SAME plaintext differ,
 *   • a tampered blob fails to decrypt (GCM auth tag rejects it),
 *   • a wrong key fails to decrypt,
 *   • importKeyFromBase64 rejects a key that isn't 32 bytes.
 *
 * `crypto.subtle` is a global (Workers runtime + node ≥20), so these run in the
 * fast node vitest env with no Worker pool.
 */
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, importKeyFromBase64 } from "./rlhfCrypto.js";

/** A deterministic 32-byte test key, base64 (NOT a real key). */
function testKeyB64(seed = 7): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (i * 31 + seed) & 0xff;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("rlhfCrypto", () => {
  it.each([
    ["ascii", "Daily tarot & rituals"],
    ["unicode", "café — naïve 🜔 occult"],
    ["empty", ""],
    ["100-char keyword field", "a".repeat(100)],
  ])("round-trips %s plaintext", async (_label, plain) => {
    const key = await importKeyFromBase64(testKeyB64());
    const blob = await encryptField(key, plain);
    if (plain) expect(blob).not.toContain(plain); // never echoes the plaintext
    const out = await decryptField(key, blob);
    expect(out).toBe(plain);
  });

  it("uses a fresh IV per call (same plaintext ⇒ different ciphertext)", async () => {
    const key = await importKeyFromBase64(testKeyB64());
    const a = await encryptField(key, "same input");
    const b = await encryptField(key, "same input");
    expect(a).not.toBe(b);
    expect(await decryptField(key, a)).toBe("same input");
    expect(await decryptField(key, b)).toBe("same input");
  });

  it("rejects a tampered blob (GCM auth tag fails)", async () => {
    const key = await importKeyFromBase64(testKeyB64());
    const blob = await encryptField(key, "ship it");
    // flip a character in the middle of the base64 blob
    const mid = Math.floor(blob.length / 2);
    const flipped = blob.slice(0, mid) + (blob[mid] === "A" ? "B" : "A") + blob.slice(mid + 1);
    await expect(decryptField(key, flipped)).rejects.toBeDefined();
  });

  it("rejects decryption under a different key", async () => {
    const key1 = await importKeyFromBase64(testKeyB64(1));
    const key2 = await importKeyFromBase64(testKeyB64(2));
    const blob = await encryptField(key1, "secret copy");
    await expect(decryptField(key2, blob)).rejects.toBeDefined();
  });

  it("rejects a key that is not 32 bytes", async () => {
    let shortBin = "";
    for (let i = 0; i < 16; i++) shortBin += String.fromCharCode(i);
    await expect(importKeyFromBase64(btoa(shortBin))).rejects.toThrow(/32/);
  });
});
