/**
 * Apple Search Ads (ASA) API v5 auth — mint a short-lived OAuth2 access token
 * from a user's ASA key bundle, so we can read Apple's OWN keyword search
 * popularity for the user's own terms (#78 item 2, Path A: per-user opt-in).
 *
 * SECURITY POSTURE (mirrors `ascJwt` / `googleAuth`): this is the ONLY place the
 * ASA private key is handled. The key bytes live in locals for one mint, are
 * never persisted, logged, or placed in an error message. Only the short-lived
 * bearer token leaves this module. The bundle is what #67's vault stores
 * (kind:"asa"), envelope-encrypted; this module operates on the decrypted
 * transient the store hands back for one use.
 *
 * Flow (Apple Search Ads API v5, OAuth2 client-credentials):
 *   1. client secret = ES256 JWT — header { alg:ES256, kid:keyId },
 *      claims { sub:clientId, aud:"https://appleid.apple.com", iss:teamId, iat,
 *      exp }, signed with the EC P-256 private key generated in the ASA account.
 *   2. POST it to appleid.apple.com/auth/oauth2/token with grant_type=
 *      client_credentials, client_id=clientId, scope=searchadsorg → access_token.
 *   3. Call api.searchads.apple.com/api/v5/... with Authorization: Bearer <token>
 *      and header X-AP-Context: orgId=<orgId>.
 * All crypto is Web Crypto (Workers + Node 18+); the HTTP call is an injected
 * `FetchLike`, so it unit-tests with a fake (the un-mockable ES256 signature is
 * exercised with a generated key in the spec, like ascJwt).
 */

/** Typed error so callers can distinguish bad creds — its message NEVER contains
 *  key material. */
export class AsaCredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsaCredError";
  }
}

/** The slice of `fetch` we need (method + body + headers; Response-like out). */
export type FetchLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * The ASA key bundle a user connects. Only `privateKey` is truly secret, but the
 * whole bundle is stored as one envelope (kind:"asa") — the identifiers are what
 * the token exchange + API context need. `keyId`/`orgId` double as the non-secret
 * `key_id`/`issuer_id` metadata the management UI shows.
 */
export type AsaKeyBundle = {
  privateKey: string; // PEM (PKCS#8, EC P-256) — the ASA API certificate private key
  clientId: string; // ASA client id
  teamId: string; // ASA team id
  keyId: string; // ASA key id (kid)
  orgId: string; // the ASA org the token operates against (X-AP-Context)
};

export const APPLEID_TOKEN_URI = "https://appleid.apple.com/auth/oauth2/token";
export const ASA_API_BASE = "https://api.searchads.apple.com/api/v5";
const ASA_SCOPE = "searchadsorg";
const APPLEID_AUD = "https://appleid.apple.com";
// Apple caps the client-secret exp at 180 days; we exchange immediately, so mint
// a short one — no reason to hand out a long-lived assertion.
const CLIENT_SECRET_TTL_SECONDS = 30 * 60;

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
    throw new AsaCredError("ASA private key is not valid PEM/base64.");
  }
  let bin: string;
  try {
    bin = atob(body);
  } catch {
    throw new AsaCredError("could not base64-decode the ASA private key.");
  }
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  if (der.length < 16 || der[0] !== 0x30) {
    throw new AsaCredError("ASA private key is not a PKCS#8 private key.");
  }
  return der;
}

/** Serialize a bundle to the vault plaintext (JSON) and back. Kept here so the
 *  on-disk envelope shape has a single owner. */
export function serializeAsaBundle(b: AsaKeyBundle): string {
  return JSON.stringify({
    privateKey: b.privateKey,
    clientId: b.clientId,
    teamId: b.teamId,
    keyId: b.keyId,
    orgId: b.orgId,
  });
}

export function parseAsaBundle(plaintext: string): AsaKeyBundle {
  let j: Partial<Record<keyof AsaKeyBundle, unknown>>;
  try {
    j = JSON.parse(plaintext) as typeof j;
  } catch {
    throw new AsaCredError("stored ASA credential is not valid JSON.");
  }
  const req = (k: keyof AsaKeyBundle): string => {
    const v = j[k];
    if (typeof v !== "string" || v.trim() === "") {
      throw new AsaCredError(`ASA credential missing ${k}.`);
    }
    return v;
  };
  return {
    privateKey: req("privateKey"),
    clientId: req("clientId"),
    teamId: req("teamId"),
    keyId: req("keyId"),
    orgId: req("orgId"),
  };
}

/**
 * Build the ES256 client-secret JWT for the client-credentials grant. `now`
 * (unix seconds) is injectable so the spec can pin time.
 */
export async function mintAsaClientSecret(
  bundle: AsaKeyBundle,
  opts: { now?: number } = {},
): Promise<string> {
  const clientId = bundle.clientId?.trim();
  const teamId = bundle.teamId?.trim();
  const keyId = bundle.keyId?.trim();
  if (!clientId) throw new AsaCredError("ASA credential missing clientId.");
  if (!teamId) throw new AsaCredError("ASA credential missing teamId.");
  if (!keyId) throw new AsaCredError("ASA credential missing keyId.");
  if (!bundle.privateKey) throw new AsaCredError("ASA credential missing privateKey.");

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(pemToDer(bundle.privateKey)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    if (e instanceof AsaCredError) throw e;
    throw new AsaCredError("ASA private key is not a valid EC P-256 private key.");
  }

  const iat = opts.now ?? Math.floor(nowSeconds());
  const header = { alg: "ES256", kid: keyId };
  const claims = { sub: clientId, aud: APPLEID_AUD, iss: teamId, iat, exp: iat + CLIENT_SECRET_TTL_SECONDS };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  let sig: ArrayBuffer;
  try {
    sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    throw new AsaCredError("failed to sign the ASA client secret.");
  }
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/** A minted access token + its lifetime (seconds). */
export type AsaAccessToken = { accessToken: string; expiresIn: number };

/**
 * Exchange an ASA key bundle for a short-lived OAuth2 access token (scope
 * searchadsorg). The token endpoint call goes through the injected `FetchLike`.
 */
export async function mintAsaAccessToken(
  fetchLike: FetchLike,
  bundle: AsaKeyBundle,
  opts: { now?: number } = {},
): Promise<AsaAccessToken> {
  const clientSecret = await mintAsaClientSecret(bundle, opts);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: bundle.clientId,
    client_secret: clientSecret,
    scope: ASA_SCOPE,
  }).toString();

  const resp = await fetchLike(APPLEID_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new AsaCredError(`ASA token exchange failed: HTTP ${resp.status}`);

  let json: { access_token?: unknown; expires_in?: unknown } | null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AsaCredError("ASA token endpoint returned non-JSON.");
  }
  const accessToken = json?.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new AsaCredError("ASA token endpoint returned no access_token.");
  }
  return {
    accessToken,
    expiresIn: typeof json?.expires_in === "number" ? json.expires_in : CLIENT_SECRET_TTL_SECONDS,
  };
}

/** The outcome of an ASA credential check. */
export type AsaVerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify an ASA key bundle works — the parallel of the ASC `.p8` verify. Mints a
 * token (proving the key + client are valid and Apple accepts them), then probes
 * `/acls` to confirm the token can reach the claimed `orgId`. Returns an honest
 * `{ ok, reason }`; the reason NEVER contains key material (`AsaCredError`
 * messages are key-free by construction).
 */
export async function verifyAsaCredentials(
  fetchLike: FetchLike,
  bundle: AsaKeyBundle,
  opts: { now?: number } = {},
): Promise<AsaVerifyResult> {
  let token: string;
  try {
    ({ accessToken: token } = await mintAsaAccessToken(fetchLike, bundle, opts));
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof AsaCredError ? e.message : "could not mint an ASA access token.",
    };
  }

  // `/acls` lists the orgs this token can act on. It confirms both that Apple
  // accepted the token and that the claimed orgId is actually reachable.
  const resp = await fetchLike(`${ASA_API_BASE}/acls`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (resp.status === 401 || resp.status === 403) {
    return { ok: false, reason: `Apple Search Ads rejected the token (${resp.status}).` };
  }
  if (resp.status < 200 || resp.status >= 300) {
    return { ok: false, reason: `Apple Search Ads /acls returned ${resp.status}.` };
  }
  let orgs: Array<{ orgId?: unknown }> = [];
  try {
    const parsed = JSON.parse(await resp.text()) as { data?: unknown };
    if (Array.isArray(parsed?.data)) orgs = parsed.data as Array<{ orgId?: unknown }>;
  } catch {
    return { ok: false, reason: "Apple Search Ads /acls returned an unexpected shape." };
  }
  const wanted = bundle.orgId.trim();
  const reachable = orgs.some((o) => String(o.orgId ?? "") === wanted);
  if (!reachable) {
    return {
      ok: false,
      reason: `the credential is valid but has no access to org ${wanted}. Check the orgId in Apple Search Ads.`,
    };
  }
  return { ok: true };
}

/** Wall clock in seconds — single home for the Date.now() call (kept injectable). */
function nowSeconds(): number {
  return Date.now() / 1000;
}
