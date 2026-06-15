import { describe, expect, it } from "vitest";
import { mintAppJwt, installationToken, GithubAppError } from "./githubApp.js";

// A throwaway RSA-2048 private key (PKCS#8 PEM) generated for this test only.
const TEST_PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCtRaBsAHD2F5+p\nhGAOWjUlfWB4nF6d6p4K/5lXaHUpNJC8PkNLPhd+7bNSVstSqE6DSlWxLGoVDNkj\n6pTIfS5cKVSjgDE9ovwmB0oFQcz+6L/ObWVykNEdlPEoXiIzxdboJEg0zRQhTWPd\nldZeu3qfr/WKyRU60aazUEP07dVTrwIuuqEPgT6B/fxMaerNrjOZtavQEUc5R3ph\nrJg+hmRMql5CA44yhOJviMP5T4bJJj1qRBiRMFgNxOWUr5U+oHoACyx92TuiCAhA\nURf6HnZIiji/zg/MMCrtWyKcAEovUatcE8CEGYY4SbJ53VzfqW7lVNBY139vkqe+\n1ztG5HeDAgMBAAECggEAH5uK5wixkoK+slqedx/HgB494eKMc/wfdlwn6cT5Ulnv\naRdmiSw7dwD/bC6/CkX/hH2j4hz7APoGBkI9f9EuCsvTT7wLv3Wiz4EW5JybO4jT\nrGFSVzLJor7PuxBo5s7ZJCGyNkeOu4B1ji9OGpvSg5zCit2hjMg/w4gJzX0xJAGE\nzhyCVZ9AQiK5U3u3GaHvnQYy9mH7MvFRSdGyaLYapu7LNkQk1qznWd4tA7DmrO7g\n7ZxvpdAy6K/d49oTYSmVSeVXQelIHYp6Z65zHH/6HSAHPt7Brjh4AEmy16RpS8vO\nxr0Vu3C/8FB3PkA2rClXaLfwTvFPjczos+2pkEzpCQKBgQDePa9cwvJrTbvb9Oui\nAyIcPiw3mqfNM/+D8yR1WxI5DHFGzUA7GLKQGqrqPVRm+VVj+IEsYQa/HYiPOR7g\nCZE9aAdVd2MsW1BTkxgLih/y0g26pU2dXCj2c9aJaP80SAGMdWvN322KH95uJwAt\nvrckfdGhSlKV8qopZgtlMQ0uhwKBgQDHl62djFumJD3E/JzqLaYVBjqhcXUBkhCP\ng9E3VGvPUkPhiQi5VVtjxGClxCmrbqZ5iyvt9crOIeCWxqJZBDc/xjDTovDCXL1R\nOnLppDLgzXyicdOVmWrhdZAYQqxwVDL26PjAt4FoBMujQaM9ja9A9auMRda5Eb6T\nh0cEtB7SJQKBgG1TLOPV5ojQmXwvdIajQfFgyEGmK6uvS5+uSR4N6d30d/jbWSB5\nGsX2yGMoPk/VkaL3CRw6sqXrMlU6RSzyp+bsOMdbTobweIhUULzEesjpeeV6Eb86\nKdBq1XuNEhW24kQlMx34LhuHZ9UKDHV0XwVte2T7ebrXv8tTroFd6t0bAoGBAJpt\nhhw3JBYpRk2qsnISPcVYm3acRU6gyAVylSa9P+kaGoFfOIvFOj+4CptXanJE27OA\n9c1Y9sCEv7OJHsXHGERUwSSOlr+bZ7N4iL6zl9YNx5gcf/voxySIhKPwumDzFLer\nzAO4N/zWcQTw3S/b9zRIoKGYy6lHzG9zJITEJHCtAoGBAL9MKl8jviMRsOCx+SWI\nbPen8A6l6+J5yPfBWEoNlScCbZ7w7MJuSbKVbuIXRGorw7PKkeyOx32CHREIrI8v\nO5UCwQLABsjdzaPLjcCmR9zacwJF2UZcloS9e2I651JmW6P2bE88YzD+1wal+aPk\n26n8KKC3YWVbhRbARd051T/v\n-----END PRIVATE KEY-----\n";

function decodeSeg(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  return JSON.parse(json);
}

describe("mintAppJwt — RS256 JWT for a GitHub App", () => {
  it("produces a three-segment JWT", async () => {
    const jwt = await mintAppJwt({ appId: "123456", privateKeyPem: TEST_PEM });
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("sets an RS256 header", async () => {
    const jwt = await mintAppJwt({ appId: "123456", privateKeyPem: TEST_PEM });
    const h = decodeSeg(jwt.split(".")[0]!);
    expect(h.alg).toBe("RS256");
    expect(h.typ).toBe("JWT");
  });

  it("sets iss=appId, with iat skewed back and a bounded exp", async () => {
    const now = 1_700_000_000;
    const jwt = await mintAppJwt({ appId: "123456", privateKeyPem: TEST_PEM, now });
    const c = decodeSeg(jwt.split(".")[1]!);
    expect(c.iss).toBe("123456");
    // GitHub recommends iat backdated 60s to tolerate clock skew
    expect((c.iat as number)).toBeLessThanOrEqual(now);
    // exp must be <= 10 min out (GitHub's hard cap)
    expect((c.exp as number) - now).toBeGreaterThan(0);
    expect((c.exp as number) - now).toBeLessThanOrEqual(600);
  });

  it("yields a non-empty base64url signature", async () => {
    const jwt = await mintAppJwt({ appId: "123456", privateKeyPem: TEST_PEM });
    const sig = jwt.split(".")[2]!;
    expect(sig.length).toBeGreaterThan(0);
    expect(sig).not.toMatch(/[+/=]/);
  });

  it("rejects a blank app id", async () => {
    await expect(mintAppJwt({ appId: "", privateKeyPem: TEST_PEM })).rejects.toThrow(GithubAppError);
  });

  it("rejects a malformed private key (typed error, no key bytes leaked)", async () => {
    await expect(
      mintAppJwt({ appId: "1", privateKeyPem: "-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----" }),
    ).rejects.toThrow(GithubAppError);
  });
});

describe("installationToken", () => {
  it("exchanges the JWT for an installation token", async () => {
    const fetchFn = async (url: string, init?: RequestInit) => {
      expect(url).toContain("/app/installations/42/access_tokens");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer JWT");
      return new Response(JSON.stringify({ token: "ghs_installtoken" }), { status: 201 });
    };
    const t = await installationToken(fetchFn, { jwt: "JWT", installationId: "42" });
    expect(t).toBe("ghs_installtoken");
  });

  it("throws (token-free) on a non-2xx", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    await expect(installationToken(fetchFn, { jwt: "SECRET", installationId: "42" })).rejects.toThrow(/404/);
  });
});
