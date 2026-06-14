/**
 * Mint an App Store Connect API JWT (ES256) from a developer's `.p8` private key.
 *
 * SECURITY POSTURE: this is the ONLY place the `.p8` is handled. The key bytes
 * live in local variables for the duration of one mint and are never persisted,
 * never logged, and never placed in an error message. Callers MUST treat the
 * returned JWT (short-lived, ≤20 min) as the only thing that leaves this module.
 *
 * Apple requires: header { alg: ES256, kid: <keyId>, typ: JWT }, claims
 * { iss: <issuerId>, iat, exp (≤20 min out), aud: "appstoreconnect-v1" }, signed
 * with the EC P-256 private key. All crypto is Web Crypto (Workers + Node 18+).
 */

/** Typed error so callers can distinguish bad creds from other failures — its
 *  message NEVER contains key material. */
export class AscCredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AscCredError";
  }
}

export type AscJwtInput = {
  p8: string; // the .p8 contents (PEM-armored or raw base64)
  keyId: string; // the API key id (kid)
  issuerId: string; // the issuer id (iss)
  now?: number; // injectable clock (unix seconds) for tests
};

const ASC_AUD = "appstoreconnect-v1";
const MAX_TTL_SECONDS = 19 * 60; // Apple caps exp at 20 min; stay safely under.

/** Strip PEM armor + whitespace → the DER (PKCS#8) bytes. */
export function parseP8(p8: string): Uint8Array {
  const body = p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new AscCredError("Not a valid .p8 key (expected base64 / PEM contents).");
  }
  let bin: string;
  try {
    bin = atob(body);
  } catch {
    throw new AscCredError("Could not base64-decode the .p8 key.");
  }
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  // PKCS#8 DER is an ASN.1 SEQUENCE → first byte 0x30, and a real key is well
  // over a handful of bytes. Cheap sanity check that rejects stray base64-ish text.
  if (der.length < 16 || der[0] !== 0x30) {
    throw new AscCredError("The .p8 does not contain a PKCS#8 private key.");
  }
  return der;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export async function mintAscJwt(input: AscJwtInput): Promise<string> {
  const keyId = input.keyId?.trim();
  const issuerId = input.issuerId?.trim();
  if (!keyId) throw new AscCredError("Missing key id.");
  if (!issuerId) throw new AscCredError("Missing issuer id.");

  const der = parseP8(input.p8);

  let key: CryptoKey;
  try {
    // fresh Uint8Array → guaranteed plain-ArrayBuffer-backed BufferSource
    key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(der),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    // never echo the key bytes
    throw new AscCredError("The .p8 is not a valid EC P-256 private key.");
  }

  const iat = input.now ?? Math.floor(nowSeconds());
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const claims = { iss: issuerId, iat, exp: iat + MAX_TTL_SECONDS, aud: ASC_AUD };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  let sig: ArrayBuffer;
  try {
    sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    throw new AscCredError("Failed to sign the App Store Connect token.");
  }

  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/** Wall clock in seconds — isolated so tests can keep `now` injectable and the
 *  Date.now() call has a single home. */
function nowSeconds(): number {
  return Date.now() / 1000;
}
