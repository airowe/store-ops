/**
 * Auth primitives — magic-link + session token crypto. All HMAC-SHA256 over
 * Web Crypto (`crypto.subtle`), available in both Workers and the node test env.
 * These are pure over (secret, clock) so we test mint/verify, tamper rejection,
 * expiry, and cookie (de)serialization with no network and no DB.
 */
import { describe, expect, it } from "vitest";
import {
  ConsoleEmailSender,
  constantTimeEqual,
  mintMagicToken,
  mintSessionToken,
  parseCookie,
  resolveSessionSecret,
  serializeSessionCookie,
  serializeLogoutCookie,
  SESSION_COOKIE,
  verifyMagicToken,
  verifySessionToken,
} from "./auth.js";

const SECRET = "test-secret-please-ignore";

describe("constantTimeEqual", () => {
  it("is true for identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });
  it("is false for differing strings of equal length", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });
  it("is false for differing lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("magic-link tokens", () => {
  it("mints a token that verifies back to the same email", async () => {
    const now = 1_000_000;
    const token = await mintMagicToken(SECRET, "User@Example.com", { now, ttlSeconds: 900 });
    const res = await verifyMagicToken(SECRET, token, { now: now + 10 });
    expect(res).toEqual({ ok: true, email: "user@example.com" });
  });

  it("lowercases + trims the email when minting", async () => {
    const now = 5;
    const token = await mintMagicToken(SECRET, "  Foo@Bar.IO  ", { now, ttlSeconds: 60 });
    const res = await verifyMagicToken(SECRET, token, { now: now + 1 });
    expect(res).toEqual({ ok: true, email: "foo@bar.io" });
  });

  it("rejects an expired token", async () => {
    const now = 1_000_000;
    const token = await mintMagicToken(SECRET, "a@b.com", { now, ttlSeconds: 900 });
    const res = await verifyMagicToken(SECRET, token, { now: now + 901 });
    expect(res.ok).toBe(false);
  });

  it("rejects a token signed with a different secret (tamper / forged signature)", async () => {
    const now = 1_000_000;
    const token = await mintMagicToken(SECRET, "a@b.com", { now, ttlSeconds: 900 });
    const res = await verifyMagicToken("other-secret", token, { now: now + 1 });
    expect(res.ok).toBe(false);
  });

  it("rejects a token whose payload was altered (signature no longer matches)", async () => {
    const now = 1_000_000;
    const token = await mintMagicToken(SECRET, "a@b.com", { now, ttlSeconds: 900 });
    const [payload, sig] = token.split(".");
    // flip the payload (different email) but keep the original signature
    const forgedPayload = btoa(JSON.stringify({ e: "evil@b.com", x: now + 900, t: "magic" }))
      .replace(/=+$/, "");
    const forged = `${forgedPayload}.${sig}`;
    expect(forged).not.toBe(token);
    expect(payload).not.toBe(forgedPayload);
    const res = await verifyMagicToken(SECRET, forged, { now: now + 1 });
    expect(res.ok).toBe(false);
  });

  it("rejects garbage / malformed tokens without throwing", async () => {
    expect((await verifyMagicToken(SECRET, "not-a-token", { now: 1 })).ok).toBe(false);
    expect((await verifyMagicToken(SECRET, "", { now: 1 })).ok).toBe(false);
    expect((await verifyMagicToken(SECRET, "a.b.c", { now: 1 })).ok).toBe(false);
  });

  it("does not accept a session token on the magic-link path (type-bound)", async () => {
    const now = 10;
    const session = await mintSessionToken(SECRET, "a@b.com", { now, ttlSeconds: 100 });
    const res = await verifyMagicToken(SECRET, session, { now: now + 1 });
    expect(res.ok).toBe(false);
  });
});

describe("session tokens", () => {
  it("mints a session token that verifies back to the same email", async () => {
    const now = 2_000_000;
    const token = await mintSessionToken(SECRET, "x@y.com", { now, ttlSeconds: 3600 });
    const res = await verifySessionToken(SECRET, token, { now: now + 100 });
    expect(res).toEqual({ ok: true, email: "x@y.com" });
  });

  it("rejects an expired session token", async () => {
    const now = 2_000_000;
    const token = await mintSessionToken(SECRET, "x@y.com", { now, ttlSeconds: 3600 });
    const res = await verifySessionToken(SECRET, token, { now: now + 3601 });
    expect(res.ok).toBe(false);
  });

  it("does not accept a magic token on the session path (type-bound)", async () => {
    const now = 10;
    const magic = await mintMagicToken(SECRET, "a@b.com", { now, ttlSeconds: 100 });
    const res = await verifySessionToken(SECRET, magic, { now: now + 1 });
    expect(res.ok).toBe(false);
  });
});

describe("cookies", () => {
  it("serializes an HttpOnly, Secure, SameSite=Lax session cookie", () => {
    const c = serializeSessionCookie("the-token", { maxAgeSeconds: 3600 });
    expect(c).toContain(`${SESSION_COOKIE}=the-token`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=3600");
  });

  it("serializes a logout cookie that expires immediately", () => {
    const c = serializeLogoutCookie();
    expect(c).toContain(`${SESSION_COOKIE}=`);
    expect(c).toContain("Max-Age=0");
  });

  it("parses a single cookie value out of a Cookie header", () => {
    const jar = parseCookie(`${SESSION_COOKIE}=abc123`);
    expect(jar[SESSION_COOKIE]).toBe("abc123");
  });

  it("parses one value among many cookies", () => {
    const jar = parseCookie(`foo=1; ${SESSION_COOKIE}=abc123; bar=2`);
    expect(jar[SESSION_COOKIE]).toBe("abc123");
    expect(jar.foo).toBe("1");
    expect(jar.bar).toBe("2");
  });

  it("returns an empty jar for null / empty header", () => {
    expect(parseCookie(null)).toEqual({});
    expect(parseCookie("")).toEqual({});
  });
});

describe("resolveSessionSecret", () => {
  it("returns the configured secret when set (any env)", () => {
    expect(resolveSessionSecret("real", "demo")).toBe("real");
    expect(resolveSessionSecret("real", "production")).toBe("real");
  });

  it("falls back to a dev secret in demo when unset", () => {
    const s = resolveSessionSecret(undefined, "demo");
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
  });

  it("throws when unset outside demo", () => {
    expect(() => resolveSessionSecret(undefined, "production")).toThrow();
  });
});

describe("ConsoleEmailSender", () => {
  it("captures the recipient + link instead of sending, and reports the channel", async () => {
    const logs: string[] = [];
    const sender = new ConsoleEmailSender((line) => logs.push(line));
    await sender.sendMagicLink("a@b.com", "https://app/auth/callback?token=xyz");
    expect(sender.channel).toBe("console");
    expect(logs.join("\n")).toContain("a@b.com");
    expect(logs.join("\n")).toContain("token=xyz");
  });
});
