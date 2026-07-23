/**
 * Pure parsing/validation for an uploaded App Store Connect .p8 key file.
 * Framework-free so it unit-tests without a DOM (matches the pure shell helpers
 * pageTitle/envPill). See docs/superpowers/specs/2026-07-22-asc-p8-upload-autofill-design.md.
 *
 * Honest by construction:
 *   • the Key ID lives ONLY in Apple's filename, never in the PEM body, so we
 *     parse it from the name or return null — we never pretend to derive it.
 *   • looksLikeEcPrivateKey is a fat-finger guard (reject a .cer / image / text
 *     file), NOT a crypto validity guarantee — the server's mint step remains
 *     the real authority on whether the key works.
 */

/** Apple downloads API keys as `AuthKey_<KEYID>.p8`. */
const FILENAME_RE = /^AuthKey_([A-Za-z0-9]+)\.p8$/;

/** Extract the Key ID from Apple's filename, or null if the name doesn't match. */
export function parseKeyIdFromFilename(name: string): string | null {
  const m = FILENAME_RE.exec(name);
  return m ? m[1] : null;
}

/**
 * Structural check that `text` is an unencrypted EC private key in PKCS#8 PEM.
 * Lenient on curve specifics; strict enough to reject a wrong file.
 */
export function looksLikeEcPrivateKey(text: string): boolean {
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  if (!text.includes(header) || !text.includes(footer)) return false;

  const body = text
    .slice(text.indexOf(header) + header.length, text.indexOf(footer))
    .replace(/\s+/g, "");
  if (body.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;

  let der: Uint8Array;
  try {
    const bin = atob(body);
    der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  // PKCS#8 PrivateKeyInfo is a DER SEQUENCE — first byte 0x30.
  return der.length > 2 && der[0] === 0x30;
}

/** Strip a single trailing newline; leave the rest of the PEM verbatim. */
export function normalizeP8(text: string): string {
  return text.replace(/\n$/, "");
}
