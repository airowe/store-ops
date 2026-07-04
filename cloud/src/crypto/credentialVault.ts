/**
 * Credential vault — envelope encryption for stored store credentials (#67
 * post-launch half). Design: docs/prd/credential-storage/00-design.md.
 *
 * ENVELOPE (AES-256-GCM, KEK/DEK), per the OWASP/NIST research:
 *   • a FRESH random 256-bit DEK per credential version → one encryption per
 *     DEK, ever, so GCM nonce reuse under a DEK is structurally impossible,
 *   • the payload is sealed with the DEK; the DEK is wrapped with the KEK,
 *   • BOTH layers authenticate the same AAD (context) → a ciphertext or wrapped
 *     DEK moved to another row/tenant/kind fails to decrypt (anti-transplant),
 *   • the KEK is a Worker secret (never in D1/repo); D1 holds only ciphertext +
 *     wrapped DEK + IVs + kek_version — separated stores (OWASP KM).
 *
 * Pure over the WebCrypto `crypto.subtle` global (Workers + node ≥20). No env
 * access here: the caller imports the KEK once and passes the CryptoKey in.
 * Plaintext is a transient local — never logged, never returned to a client.
 */

const IV_BYTES = 12; // 96-bit GCM nonce

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The context bound into BOTH layers' AAD. Changing any field makes an existing
 * blob undecryptable — that's the point (a credential can't be replayed for a
 * different user/app/kind, or across a KEK generation).
 */
export type VaultContext = {
  userId: string;
  /** app the credential is linked to, or "-" for an account-level (unlinked) key. */
  appId: string;
  /** "asc" (.p8) | "play" (service-account json). */
  kind: "asc" | "play";
  kekVersion: number;
};

/** The stored envelope — every field is safe to persist in D1 (no key material). */
export type SealedCredential = {
  /** base64(IV ++ payload-ciphertext+tag). */
  ciphertext: string;
  /** base64(IV ++ wrapped-DEK+tag). */
  wrappedDek: string;
  kekVersion: number;
};

/** Serialize the context to the AAD byte string (stable field order). */
function aadBytes(ctx: VaultContext): Uint8Array {
  return new TextEncoder().encode(
    `v1|${ctx.userId}|${ctx.appId}|${ctx.kind}|${ctx.kekVersion}`,
  );
}

/** Import a base64 32-byte KEK as a non-extractable wrap/unwrap AES-GCM key. */
export async function importKek(b64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(b64);
  if (raw.byteLength !== 32) {
    throw new Error(`CRED_KEK must decode to 32 bytes, got ${raw.byteLength}`);
  }
  // The KEK only ever encrypts/decrypts DEKs (single-purpose, NIST via OWASP).
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Seal one GCM layer: base64(IV ++ ciphertext+tag), AAD-authenticated. */
async function seal(key: CryptoKey, data: Uint8Array, aad: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, data),
  );
  const blob = new Uint8Array(iv.byteLength + cipher.byteLength);
  blob.set(iv, 0);
  blob.set(cipher, iv.byteLength);
  return bytesToB64(blob);
}

/** Open one GCM layer. Throws on a tag mismatch (tamper / wrong key / wrong AAD). */
async function open(key: CryptoKey, blob: string, aad: Uint8Array): Promise<Uint8Array> {
  const bytes = b64ToBytes(blob);
  if (bytes.byteLength <= IV_BYTES) throw new Error("sealed blob too short");
  const iv = bytes.subarray(0, IV_BYTES);
  const cipher = bytes.subarray(IV_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, cipher),
  );
}

/**
 * Seal a plaintext credential under a fresh DEK, wrap the DEK with the KEK.
 * Both layers bind `ctx` as AAD (with ctx.kekVersion). Returns the persistable
 * envelope; the plaintext and the DEK never leave this function.
 */
export async function sealCredential(
  kek: CryptoKey,
  plaintext: string,
  ctx: VaultContext,
): Promise<SealedCredential> {
  const aad = aadBytes(ctx);
  // Fresh 256-bit DEK, extractable ONLY so we can wrap its raw bytes; it never
  // leaves memory and is used for exactly this one encryption.
  const dek = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ])) as CryptoKey;
  const ciphertext = await seal(dek, new TextEncoder().encode(plaintext), aad);
  const rawDek = new Uint8Array((await crypto.subtle.exportKey("raw", dek)) as ArrayBuffer);
  const wrappedDek = await seal(kek, rawDek, aad);
  return { ciphertext, wrappedDek, kekVersion: ctx.kekVersion };
}

/**
 * Unwrap the DEK with the KEK, then decrypt the payload. Throws if anything is
 * tampered, the KEK is wrong, or the context doesn't match what was sealed.
 */
export async function openCredential(
  kek: CryptoKey,
  sealed: SealedCredential,
  ctx: VaultContext,
): Promise<string> {
  const aad = aadBytes({ ...ctx, kekVersion: sealed.kekVersion });
  const rawDek = await open(kek, sealed.wrappedDek, aad);
  const dek = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await open(dek, sealed.ciphertext, aad);
  return new TextDecoder().decode(plain);
}

/**
 * Rotation (lazy re-wrap): re-wrap the SAME DEK under a new KEK without touching
 * the payload ciphertext. Used on a successful read when a row's kek_version is
 * behind the current one. `oldCtx`/`newCtx` differ only in kekVersion.
 */
export async function rewrapDek(
  oldKek: CryptoKey,
  newKek: CryptoKey,
  sealed: SealedCredential,
  ctx: Omit<VaultContext, "kekVersion">,
  newKekVersion: number,
): Promise<SealedCredential> {
  const oldAad = aadBytes({ ...ctx, kekVersion: sealed.kekVersion });
  const rawDek = await open(oldKek, sealed.wrappedDek, oldAad);
  // The payload ciphertext's AAD carries the OLD kekVersion, so it must be
  // re-sealed too — decrypt with the old DEK/AAD, re-seal under the new AAD.
  const oldDek = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
  const payload = await open(oldDek, sealed.ciphertext, oldAad);
  const newAad = aadBytes({ ...ctx, kekVersion: newKekVersion });
  const ciphertext = await seal(oldDek, payload, newAad);
  const wrappedDek = await seal(newKek, rawDek, newAad);
  return { ciphertext, wrappedDek, kekVersion: newKekVersion };
}
