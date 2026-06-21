/**
 * AES-256-GCM encryption for the RLHF proposal-edit values at rest (#39 Part 2).
 *
 * The copy text a user edits is NEVER stored in plaintext. Each value is sealed
 * with a fresh random 12-byte IV under a 256-bit key (env.RLHF_ENCRYPTION_KEY, a
 * base64 32-byte secret). The on-disk blob is base64(IV ++ ciphertext+tag) — the
 * IV travels with the ciphertext so decryption is self-contained.
 *
 * Uses the WebCrypto `crypto.subtle` global (present in the Workers runtime and
 * node ≥20) — do NOT import it. Pure functions, no env access here: the caller
 * imports the key once and passes the CryptoKey in.
 */

const IV_BYTES = 12; // 96-bit nonce, the AES-GCM standard

/** base64 → Uint8Array. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array → base64. */
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Import the base64-encoded 32-byte key as a non-extractable AES-GCM CryptoKey.
 * Throws if the decoded key is not exactly 32 bytes (a misconfigured secret must
 * fail loudly at import, never silently weaken encryption).
 */
export async function importKeyFromBase64(b64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(b64);
  if (raw.byteLength !== 32) {
    throw new Error(`RLHF_ENCRYPTION_KEY must decode to 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a plaintext field → base64(IV ++ ciphertext+tag). */
export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
  );
  const blob = new Uint8Array(iv.byteLength + cipher.byteLength);
  blob.set(iv, 0);
  blob.set(cipher, iv.byteLength);
  return bytesToB64(blob);
}

/**
 * Decrypt a base64(IV ++ ciphertext+tag) blob back to plaintext. Throws if the
 * blob is malformed, tampered (GCM auth-tag mismatch), or under the wrong key.
 */
export async function decryptField(key: CryptoKey, blob: string): Promise<string> {
  const bytes = b64ToBytes(blob);
  if (bytes.byteLength <= IV_BYTES) {
    throw new Error("ciphertext blob too short");
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const cipher = bytes.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
