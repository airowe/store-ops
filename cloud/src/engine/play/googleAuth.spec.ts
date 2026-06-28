import { beforeAll, describe, expect, it } from "vitest";
import {
  ANDROIDPUBLISHER_SCOPE,
  type FetchLike,
  type GoogleServiceAccount,
  GoogleAuthError,
  buildServiceAccountAssertion,
  mintGoogleAccessToken,
  playApiTransport,
  playApiTransportForServiceAccount,
  verifyPlayServiceAccount,
} from "./googleAuth.js";

/** Decode a base64url JWT segment to JSON. */
function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

let SA: GoogleServiceAccount;
let publicKey: CryptoKey;

beforeAll(async () => {
  // A real RSA key so the RS256 signature path is genuinely exercised.
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = kp.publicKey;
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer,
  );
  let b64 = "";
  for (let i = 0; i < pkcs8.length; i++) b64 += String.fromCharCode(pkcs8[i]!);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(b64).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
  SA = {
    client_email: "svc@my-proj.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.test/token",
  };
});

describe("buildServiceAccountAssertion", () => {
  it("produces a verifiable RS256 JWT with the right claims", async () => {
    const jwt = await buildServiceAccountAssertion(SA, { now: 1_000_000 });
    const [h, c, s] = jwt.split(".");
    expect(decodeSegment(h!)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decodeSegment(c!);
    expect(claims.iss).toBe(SA.client_email);
    expect(claims.scope).toBe(ANDROIDPUBLISHER_SCOPE);
    expect(claims.aud).toBe("https://oauth2.test/token");
    expect(claims.iat).toBe(1_000_000);
    expect(claims.exp).toBe(1_000_000 + 3600);

    // The signature actually verifies against the public key.
    const sig = Uint8Array.from(atob(s!.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("rejects a non-PEM private key without echoing key material", async () => {
    await expect(
      buildServiceAccountAssertion({ ...SA, private_key: "not a key" }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe("mintGoogleAccessToken", () => {
  it("POSTs the jwt-bearer grant to the token uri and returns the access token", async () => {
    let captured: { url: string; body: string | undefined } | null = null;
    const fetchLike: FetchLike = async (url, init) => {
      captured = { url, body: init.body };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "ya29.test-token", expires_in: 3599 }),
      };
    };
    const tok = await mintGoogleAccessToken(fetchLike, SA, { now: 1_000_000 });
    expect(tok.accessToken).toBe("ya29.test-token");
    expect(tok.expiresIn).toBe(3599);
    expect(captured!.url).toBe("https://oauth2.test/token");
    expect(captured!.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(captured!.body).toContain("assertion=");
  });

  it("throws on a non-200 token response", async () => {
    const fetchLike: FetchLike = async () => ({ ok: false, status: 401, text: async () => "denied" });
    await expect(mintGoogleAccessToken(fetchLike, SA)).rejects.toThrow(/token exchange failed/);
  });

  it("throws when the token endpoint returns no access_token", async () => {
    const fetchLike: FetchLike = async () => ({ ok: true, status: 200, text: async () => "{}" });
    await expect(mintGoogleAccessToken(fetchLike, SA)).rejects.toThrow(/no access_token/);
  });
});

describe("playApiTransport", () => {
  it("attaches the bearer token and returns {status, body}", async () => {
    let seen: { url: string; method: string; auth: string | undefined } | null = null;
    const fetchLike: FetchLike = async (url, init) => {
      seen = { url, method: init.method, auth: init.headers?.["Authorization"] };
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const transport = playApiTransport(fetchLike, "tok-abc");
    const out = await transport({ method: "GET", url: "https://androidpublisher.googleapis.com/x" });
    expect(out).toEqual({ status: 200, body: "{}" });
    expect(seen!.auth).toBe("Bearer tok-abc");
    expect(seen!.method).toBe("GET");
  });

  it("playApiTransportForServiceAccount mints then attaches the token", async () => {
    const fetchLike: FetchLike = async (url) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.includes("/token") ? JSON.stringify({ access_token: "minted", expires_in: 3600 }) : "{}",
    });
    const transport = await playApiTransportForServiceAccount(fetchLike, SA, { now: 1 });
    // A subsequent API call carries the minted token (smoke: it resolves).
    const out = await transport({ method: "POST", url: "https://androidpublisher.googleapis.com/edits" });
    expect(out.status).toBe(200);
  });
});

describe("verifyPlayServiceAccount", () => {
  const tokenOk: FetchLike = async (url, init) => {
    if (url.includes("/token")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok", expires_in: 3600 }) };
    }
    if (init.method === "POST" && url.endsWith("/edits")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "edit-1" }) };
    }
    return { ok: true, status: 204, text: async () => "" }; // DELETE
  };

  it("ok:true when the token mints and no package is probed", async () => {
    const res = await verifyPlayServiceAccount(
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: "t", expires_in: 1 }) }),
      SA,
      { now: 1 },
    );
    expect(res.ok).toBe(true);
  });

  it("probes app access (edits.insert) and discards the edit when a package is given", async () => {
    const calls: string[] = [];
    const wrapped: FetchLike = async (url, init) => {
      calls.push(`${init.method} ${url.split("/v3/")[1] ?? url}`);
      return tokenOk(url, init);
    };
    const res = await verifyPlayServiceAccount(wrapped, SA, { packageName: "com.calm.android", now: 1 });
    expect(res).toEqual({ ok: true, appAccessible: true });
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(true); // probe edit cleaned up
  });

  it("ok:false with a clear reason when the token mint fails", async () => {
    const res = await verifyPlayServiceAccount(
      async () => ({ ok: false, status: 401, text: async () => "denied" }),
      SA,
      { now: 1 },
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.reason).toMatch(/token exchange failed/);
  });

  it("ok:false when Google rejects app access (403)", async () => {
    const fetchLike: FetchLike = async (url) =>
      url.includes("/token")
        ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok", expires_in: 1 }) }
        : { ok: false, status: 403, text: async () => "forbidden" };
    const res = await verifyPlayServiceAccount(fetchLike, SA, { packageName: "com.x", now: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.reason).toMatch(/Grant the service account access/);
  });
});
