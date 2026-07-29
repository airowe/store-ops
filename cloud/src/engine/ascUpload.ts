/**
 * App Store Connect asset upload — the pure half (#374).
 *
 * Apple's screenshot upload is a three-step reservation, not a POST:
 *   1. POST /appScreenshots   declare fileSize + fileName → `uploadOperations`
 *   2. PUT  each operation    exactly the slices Apple asked for
 *   3. PATCH /appScreenshots/{id}  { uploaded: true, sourceFileChecksum }
 *
 * This module holds the parts that must be provably correct BEFORE any bytes
 * move: the checksum, the slice plan, and the placeholder refusal. The I/O lives
 * in ascUploadClient.ts with an injected fetch, so these stay pure and testable.
 */

/** One `uploadOperations` entry as App Store Connect returns it. */
export type UploadOperation = {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: Array<{ name: string; value: string }> | undefined;
};

/** A ready-to-PUT slice: exactly the bytes Apple asked for, at its URL. */
export type UploadPart = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

// ── MD5 ──────────────────────────────────────────────────────────────────────
//
// Hand-rolled because WebCrypto does NOT implement MD5 — `crypto.subtle.digest
// ("MD5", …)` throws NotSupportedError on both the Workers runtime and Node —
// and Apple's commit step requires `sourceFileChecksum` as MD5. There is no
// alternative digest to negotiate: the field is defined as MD5.
//
// MD5 is used here purely as a TRANSFER INTEGRITY check that Apple specifies.
// It is not used for security, and must never be used for one in this codebase.
//
// RFC 1321. Verified against the published test vectors in the spec.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0;

/** MD5 of `data`, lowercase hex. Byte-exact and binary-safe. */
export function md5Hex(data: Uint8Array): string {
  const len = data.length;
  // padded length: message + 0x80 + zeros → ≡ 56 (mod 64), + 8-byte length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[len] = 0x80;
  // 64-bit little-endian bit length (high word only matters past 512MB)
  const bitLen = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(chunk + j * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i]!)) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── upload plan ──────────────────────────────────────────────────────────────

/**
 * Slice `file` into exactly the parts Apple's reservation asked for.
 *
 * Apple dictates the chunking via `uploadOperations`; inventing our own would
 * corrupt the asset. Validates that the operations cover the file EXACTLY —
 * a short or overlapping plan produces a corrupt upload that Apple rejects only
 * at commit, i.e. after every byte has already been transferred. Failing here
 * costs nothing; failing there costs the whole upload.
 */
export function planUploadParts(file: Uint8Array, ops: UploadOperation[]): UploadPart[] {
  if (ops.length === 0) throw new Error("no upload operations returned by App Store Connect");

  let covered = 0;
  const parts: UploadPart[] = [];
  for (const op of ops) {
    const end = op.offset + op.length;
    if (end > file.length) {
      throw new Error(
        `upload operation runs past the end of the file (offset ${op.offset} + ${op.length} > ${file.length})`,
      );
    }
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    parts.push({
      method: op.method || "PUT",
      url: op.url,
      headers,
      body: file.subarray(op.offset, end),
    });
    covered += op.length;
  }

  if (covered !== file.length) {
    throw new Error(
      `upload operations do not cover the file exactly (${covered} of ${file.length} bytes)`,
    );
  }
  return parts;
}

// ── placeholder refusal ──────────────────────────────────────────────────────

/**
 * Is this a renderer PLACEHOLDER rather than a real captured screen?
 *
 * `lib/render_localized_shots.py` stamps a watermark when a locale was never
 * reviewed or no real capture existed, precisely so it cannot be mistaken for a
 * shippable asset. Uploading one would put a fabricated image on a live App
 * Store listing — the exact class of thing this product forbids.
 *
 * Refused HARD at the upload boundary rather than warned about: a warning in a
 * pipeline is a thing people click past.
 */
export function isPlaceholderAsset(fileName: string): boolean {
  return /needsreview|placeholder/i.test(fileName);
}
