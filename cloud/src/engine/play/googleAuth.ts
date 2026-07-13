/**
 * Google service-account auth for the Play Developer API — mint a short-lived
 * OAuth2 access token from a service-account JSON, and build the concrete
 * `PlayApiTransport` the read path needs.
 *
 * SECURITY POSTURE (mirrors `ascJwt`): this is the ONLY place the service-account
 * private key is handled. The key bytes live in locals for one mint, are never
 * persisted, logged, or placed in an error message. Only the short-lived bearer
 * token leaves this module.
 *
 * Flow: build a signed JWT assertion (RS256) — iss=client_email, scope=
 * androidpublisher, aud=token_uri — POST it to the OAuth2 token endpoint with the
 * jwt-bearer grant, and get back an access_token. All crypto is Web Crypto
 * (Workers + Node 18+). The HTTP call is an injected `FetchLike`, so it unit-tests
 * with a fake (the only un-mockable bit, the RSA signature, is exercised with a
 * generated key in the spec).
 */
import type { PlayApiTransport } from "./playDeveloperApi.js";

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** The slice of `fetch` we need (method + body + headers; Response-like out). */
export type FetchLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The fields we read from a Google service-account JSON. */
export type GoogleServiceAccount = {
  client_email: string;
  private_key: string; // PEM (PKCS#8 RSA)
  token_uri?: string;
};

export const ANDROIDPUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
/** Read scope for the Play Developer Reporting API (Android vitals, #vitals). */
export const PLAYDEVELOPERREPORTING_SCOPE =
  "https://www.googleapis.com/auth/playdeveloperreporting";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const TOKEN_TTL_SECONDS = 3600; // Google caps the assertion exp at 1 hour.

/**
 * Resolve + VALIDATE the OAuth token endpoint. The assertion is signed and POSTed
 * here, so a hostile/typo'd `token_uri` in the supplied JSON must not be able to
 * redirect the flow to an arbitrary host (SSRF defense-in-depth). We require
 * https + a googleapis.com host; anything else is rejected. A real Google
 * service-account JSON always uses https://oauth2.googleapis.com/token.
 */
function resolveTokenUri(raw?: string): string {
  const uri = raw?.trim() || DEFAULT_TOKEN_URI;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new GoogleAuthError("service-account token_uri is not a valid URL.");
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !(host === "googleapis.com" || host.endsWith(".googleapis.com"))) {
    throw new GoogleAuthError("service-account token_uri must be an https googleapis.com endpoint.");
  }
  return uri;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** Strip PEM armor + whitespace → the DER (PKCS#8) bytes. Never echoes the key. */
function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new GoogleAuthError("service-account private_key is not valid PEM/base64.");
  }
  let bin: string;
  try {
    bin = atob(body);
  } catch {
    throw new GoogleAuthError("could not base64-decode the service-account private_key.");
  }
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  if (der.length < 16 || der[0] !== 0x30) {
    throw new GoogleAuthError("service-account private_key is not a PKCS#8 private key.");
  }
  return der;
}

/**
 * Build the signed RS256 JWT assertion for the jwt-bearer grant. `now`
 * (unix seconds) is injectable so the spec can pin time.
 */
export async function buildServiceAccountAssertion(
  sa: GoogleServiceAccount,
  opts: { scope?: string; now?: number } = {},
): Promise<string> {
  const clientEmail = sa.client_email?.trim();
  if (!clientEmail) throw new GoogleAuthError("service account missing client_email.");
  if (!sa.private_key) throw new GoogleAuthError("service account missing private_key.");
  const tokenUri = resolveTokenUri(sa.token_uri);
  const scope = opts.scope ?? ANDROIDPUBLISHER_SCOPE;
  const iat = opts.now ?? Math.floor(nowSeconds());

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(pemToDer(sa.private_key)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    if (e instanceof GoogleAuthError) throw e;
    throw new GoogleAuthError("service-account private_key is not a valid RSA key.");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: clientEmail, scope, aud: tokenUri, iat, exp: iat + TOKEN_TTL_SECONDS };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  let sig: ArrayBuffer;
  try {
    sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    throw new GoogleAuthError("failed to sign the service-account assertion.");
  }
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/** A minted access token + its lifetime (seconds). */
export type GoogleAccessToken = { accessToken: string; expiresIn: number };

/**
 * Exchange a service-account JSON for a short-lived OAuth2 access token (scope
 * androidpublisher). The token endpoint call goes through the injected `FetchLike`.
 */
export async function mintGoogleAccessToken(
  fetchLike: FetchLike,
  sa: GoogleServiceAccount,
  opts: { scope?: string; now?: number } = {},
): Promise<GoogleAccessToken> {
  const tokenUri = resolveTokenUri(sa.token_uri);
  const assertion = await buildServiceAccountAssertion(sa, opts);
  const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString();

  const resp = await fetchLike(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new GoogleAuthError(`token exchange failed: HTTP ${resp.status}`);

  let json: { access_token?: unknown; expires_in?: unknown } | null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GoogleAuthError("token endpoint returned non-JSON.");
  }
  const accessToken = json?.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new GoogleAuthError("token endpoint returned no access_token.");
  }
  return {
    accessToken,
    expiresIn: typeof json?.expires_in === "number" ? json.expires_in : TOKEN_TTL_SECONDS,
  };
}

/** Build a `PlayApiTransport` from a bearer token (attaches the auth header). */
export function playApiTransport(fetchLike: FetchLike, accessToken: string): PlayApiTransport {
  return async ({ method, url }) => {
    const resp = await fetchLike(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    return { status: resp.status, body: await resp.text() };
  };
}

/**
 * Convenience: mint a token from the service account and return a ready
 * `PlayApiTransport`. The token is captured in the closure and reused across the
 * read path's 3 requests (insert/list/delete) — one mint per audit.
 */
export async function playApiTransportForServiceAccount(
  fetchLike: FetchLike,
  sa: GoogleServiceAccount,
  opts: { scope?: string; now?: number } = {},
): Promise<PlayApiTransport> {
  const { accessToken } = await mintGoogleAccessToken(fetchLike, sa, opts);
  return playApiTransport(fetchLike, accessToken);
}

const ANDROIDPUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

/** The outcome of a service-account credential check. */
export type PlayVerifyResult =
  | { ok: true; appAccessible?: boolean }
  | { ok: false; reason: string };

/**
 * Verify a Play service account works — the parallel of the App Store Connect
 * `.p8` verify. Mints a token (proving the key + service account are valid and
 * Google accepts them); if a `packageName` is given, also probes app-level access
 * by opening and immediately discarding a Play edit (read-only — never commits).
 *
 * Returns an honest `{ ok, reason }`; the reason NEVER contains key material
 * (`GoogleAuthError` messages are key-free by construction).
 */
export async function verifyPlayServiceAccount(
  fetchLike: FetchLike,
  sa: GoogleServiceAccount,
  opts: { packageName?: string; now?: number } = {},
): Promise<PlayVerifyResult> {
  let token: string;
  try {
    ({ accessToken: token } = await mintGoogleAccessToken(
      fetchLike,
      sa,
      opts.now !== undefined ? { now: opts.now } : {},
    ));
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof GoogleAuthError
          ? e.message
          : "could not mint an access token from the service account.",
    };
  }

  const pkg = opts.packageName?.trim();
  if (!pkg) return { ok: true }; // credential is structurally valid; app access not probed.

  const appsBase = `${ANDROIDPUBLISHER_BASE}/applications/${encodeURIComponent(pkg)}`;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const res = await fetchLike(`${appsBase}/edits`, { method: "POST", headers: auth });
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: `Google rejected access to ${pkg} (${res.status}). Grant the service account access to this app in the Play Console.`,
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `Play Developer API returned ${res.status} for ${pkg}.` };
  }

  // Discard the probe edit (best-effort — never commit, never leak an edit).
  let editId: string | undefined;
  try {
    editId = (JSON.parse(await res.text()) as { id?: string }).id;
  } catch {
    editId = undefined;
  }
  if (editId) {
    try {
      await fetchLike(`${appsBase}/edits/${encodeURIComponent(editId)}`, {
        method: "DELETE",
        headers: auth,
      });
    } catch {
      // dangling edits expire on their own.
    }
  }
  return { ok: true, appAccessible: true };
}

/** Wall clock in seconds — single home for the Date.now() call (kept injectable). */
function nowSeconds(): number {
  return Date.now() / 1000;
}
