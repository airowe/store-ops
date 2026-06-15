/**
 * GitHub App auth (issue #8). Two steps:
 *   1. mintAppJwt — sign a short-lived RS256 JWT with the App's private key.
 *   2. installationToken — exchange that JWT for a per-installation access token
 *      (~1h, scoped to the repos the App is installed on).
 *
 * The App private key is SHIPASO's secret (a Worker secret), not the user's. We
 * store only the non-sensitive installation id per user. The key never leaves
 * this module and never appears in an error message.
 */

export class GithubAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAppError";
  }
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj: unknown): string {
  return b64url(enc.encode(JSON.stringify(obj)));
}

/** Strip PEM armor → DER bytes, with a cheap PKCS#8 sanity check. */
function parsePkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new GithubAppError("Not a valid PEM private key.");
  }
  let bin: string;
  try {
    bin = atob(body);
  } catch {
    throw new GithubAppError("Could not base64-decode the private key.");
  }
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  if (der.length < 64 || der[0] !== 0x30) {
    throw new GithubAppError("The private key is not a PKCS#8 RSA key.");
  }
  return der;
}

export type AppJwtInput = {
  appId: string;
  privateKeyPem: string;
  now?: number; // injectable clock (unix seconds) for tests
};

/** GitHub caps App-JWT exp at 10 min; iat is backdated 60s for clock skew. */
const IAT_SKEW = 60;
const TTL = 9 * 60; // 9 min, safely under the 10-min cap

export async function mintAppJwt(input: AppJwtInput): Promise<string> {
  const appId = input.appId?.trim();
  if (!appId) throw new GithubAppError("Missing GitHub App id.");

  const der = parsePkcs8(input.privateKeyPem);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(der),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new GithubAppError("The private key is not a valid RSA key for RS256.");
  }

  const t = input.now ?? Math.floor(nowSeconds());
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: appId, iat: t - IAT_SKEW, exp: t + TTL };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  let sig: ArrayBuffer;
  try {
    sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  } catch {
    throw new GithubAppError("Failed to sign the GitHub App token.");
  }
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Exchange the App JWT for a short-lived installation access token.
 * POST /app/installations/{installation_id}/access_tokens with the JWT as Bearer.
 */
export async function installationToken(
  fetchFn: FetchLike,
  opts: { jwt: string; installationId: string },
): Promise<string> {
  const res = await fetchFn(
    `https://api.github.com/app/installations/${encodeURIComponent(opts.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.jwt}`,
        accept: "application/vnd.github+json",
        "user-agent": "ShipASO",
      },
    },
  );
  if (!res.ok) {
    const detail = await githubDetail(res);
    throw new GithubAppError(`GitHub rejected the installation token request (${res.status})${detail}`);
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!body.token) throw new GithubAppError("GitHub returned no installation token.");
  return body.token;
}

/** Pull a token-free `: message` off a GitHub error body. */
export async function githubDetail(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { message?: string };
    return b.message ? `: ${b.message}` : "";
  } catch {
    return "";
  }
}

function nowSeconds(): number {
  return Date.now() / 1000;
}
