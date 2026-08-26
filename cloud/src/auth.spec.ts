/**
 * Auth primitives — magic-link + session token crypto. All HMAC-SHA256 over
 * Web Crypto (`crypto.subtle`), available in both Workers and the node test env.
 * These are pure over (secret, clock) so we test mint/verify, tamper rejection,
 * expiry, and cookie (de)serialization with no network and no DB.
 */
import { describe, expect, it } from "vitest";
import {
  ConsoleEmailSender,
  APPROVAL_NONCE_TTL_SECONDS,
  constantTimeEqual,
  mintApprovalNonce,
  mintMagicToken,
  mintSessionToken,
  parseCookie,
  ResendEmailSender,
  resolveSessionSecret,
  serializeSessionCookie,
  serializeLogoutCookie,
  SESSION_COOKIE,
  verifyApprovalNonce,
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
  it("serializes an HttpOnly, Secure, SameSite=Lax session cookie by default", () => {
    const c = serializeSessionCookie("the-token", { maxAgeSeconds: 3600 });
    expect(c).toContain(`${SESSION_COOKIE}=the-token`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=3600");
    expect(c).not.toContain("Domain="); // no Domain unless asked
  });

  it("supports SameSite=None + a Domain for cross-subdomain (app↔api) sessions", () => {
    const c = serializeSessionCookie("tok", {
      maxAgeSeconds: 3600,
      sameSite: "None",
      domain: ".shipaso.com",
    });
    expect(c).toContain("SameSite=None");
    expect(c).toContain("Secure"); // None REQUIRES Secure
    expect(c).toContain("Domain=.shipaso.com");
  });

  it("serializes a logout cookie that expires immediately", () => {
    const c = serializeLogoutCookie();
    expect(c).toContain(`${SESSION_COOKIE}=`);
    expect(c).toContain("Max-Age=0");
  });

  it("clears the cookie on the same Domain it was set with (so it actually clears)", () => {
    const c = serializeLogoutCookie({ domain: ".shipaso.com", sameSite: "None" });
    expect(c).toContain("Domain=.shipaso.com");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("SameSite=None");
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

describe("ResendEmailSender", () => {
  type Call = { url: string; init: RequestInit };
  function mockFetch(status = 200, body: unknown = { id: "email_123" }) {
    const calls: Call[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("POSTs to the Resend API with bearer auth and the link in the body", async () => {
    const { fn, calls } = mockFetch();
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "store-ops <login@mail.airowe.online>",
      fetchFn: fn,
    });
    await sender.sendMagicLink("user@example.com", "https://app/auth/callback?token=abc");

    expect(sender.channel).toBe("resend");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(calls[0]!.init.body as string);
    expect(payload.from).toBe("store-ops <login@mail.airowe.online>");
    expect(payload.to).toEqual(["user@example.com"]);
    expect(typeof payload.subject).toBe("string");
    // both the html and text parts must carry the magic link
    expect(payload.html).toContain("https://app/auth/callback?token=abc");
    expect(payload.text).toContain("https://app/auth/callback?token=abc");
  });

  it("throws when Resend returns a non-2xx (so /auth/request can surface failure)", async () => {
    const { fn } = mockFetch(422, { message: "domain not verified" });
    const sender = new ResendEmailSender({ apiKey: "k", from: "x@y.com", fetchFn: fn });
    await expect(
      sender.sendMagicLink("user@example.com", "https://app/cb?token=t"),
    ).rejects.toThrow(/resend/i);
  });

  it("uses the global fetch with a correct `this` when none is injected (no illegal invocation)", async () => {
    // Reproduce the Workers gotcha: a global fetch that throws if called with the
    // wrong receiver (i.e. as a bare method off the instance). The sender must
    // bind it to globalThis so `this.fetchFn(...)` doesn't strip the binding.
    const realFetch = globalThis.fetch;
    let sawGoodThis = false;
    const guarded = function (this: unknown, _url: string, _init: RequestInit) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      sawGoodThis = true;
      return Promise.resolve(new Response(JSON.stringify({ id: "ok" }), { status: 200 }));
    };
    globalThis.fetch = guarded as unknown as typeof fetch;
    try {
      const sender = new ResendEmailSender({ apiKey: "k", from: "x@y.com" }); // no fetchFn
      await sender.sendMagicLink("u@e.com", "https://app/cb?token=t");
      expect(sawGoodThis).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("escapes HTML in the link so it can't break out of the anchor", async () => {
    const { fn, calls } = mockFetch();
    const sender = new ResendEmailSender({ apiKey: "k", from: "x@y.com", fetchFn: fn });
    await sender.sendMagicLink("u@e.com", 'https://app/cb?token=a"><script>x</script>');
    const payload = JSON.parse(calls[0]!.init.body as string);
    expect(payload.html).not.toContain("<script>x</script>");
    expect(payload.html).toContain("&lt;script&gt;");
  });
});

import { mintListUnsubToken, verifyListUnsubToken, verifyUnsubToken } from "./auth.js";

describe("list-unsub token", () => {
  const secret = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  it("round-trips the email", async () => {
    const t = await mintListUnsubToken(secret, "Me@X.com", { ttlSeconds: 3600 });
    expect(await verifyListUnsubToken(secret, t)).toEqual({ ok: true, email: "me@x.com" });
  });
  it("is audience-separated: a digest unsub token does NOT verify as list-unsub", async () => {
    const digest = await (await import("./auth.js")).mintUnsubToken(secret, "me@x.com", { ttlSeconds: 3600 });
    expect(await verifyListUnsubToken(secret, digest)).toEqual({ ok: false });
  });
  it("and a list-unsub token does NOT verify as a digest unsub token", async () => {
    const t = await mintListUnsubToken(secret, "me@x.com", { ttlSeconds: 3600 });
    expect(await verifyUnsubToken(secret, t)).toEqual({ ok: false });
  });
  it("rejects an expired token", async () => {
    const t = await mintListUnsubToken(secret, "me@x.com", { now: 1000, ttlSeconds: 60 });
    expect(await verifyListUnsubToken(secret, t, { now: 2000 })).toEqual({ ok: false });
  });
});

import { mintReviewToken, verifyReviewToken } from "./auth.js";

describe("review token (App Review sign-in, #2.1(a))", () => {
  const secret = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const reviewer = "adaminsley+shipaso-review@gmail.com";

  it("round-trips the email", async () => {
    const t = await mintReviewToken(secret, reviewer, { ttlSeconds: 3600 });
    expect(await verifyReviewToken(secret, t)).toEqual({ ok: true, email: reviewer });
  });

  it("survives a long TTL — the whole point is that it can be written into review notes", async () => {
    const ninetyDays = 90 * 24 * 60 * 60;
    const t = await mintReviewToken(secret, reviewer, { now: 1000, ttlSeconds: ninetyDays });
    // 89 days later it is still good; the 15-minute magic TTL is what stranded App Review.
    expect(await verifyReviewToken(secret, t, { now: 1000 + 89 * 24 * 60 * 60 })).toEqual({
      ok: true,
      email: reviewer,
    });
  });

  it("still expires — it is long-lived, not eternal", async () => {
    const t = await mintReviewToken(secret, reviewer, { now: 1000, ttlSeconds: 60 });
    expect(await verifyReviewToken(secret, t, { now: 2000 })).toEqual({ ok: false });
  });

  it("is audience-separated: a magic token does NOT verify as a review token", async () => {
    const magic = await mintMagicToken(secret, reviewer, { ttlSeconds: 3600 });
    expect(await verifyReviewToken(secret, magic)).toEqual({ ok: false });
  });

  it("and a review token does NOT verify as a magic token", async () => {
    const t = await mintReviewToken(secret, reviewer, { ttlSeconds: 3600 });
    expect(await verifyMagicToken(secret, t)).toEqual({ ok: false });
  });

  it("and a review token does NOT verify as a session token — it must be exchanged, never replayed", async () => {
    const t = await mintReviewToken(secret, reviewer, { ttlSeconds: 3600 });
    expect(await verifySessionToken(secret, t)).toEqual({ ok: false });
  });

  it("rejects a token signed with a different secret", async () => {
    const t = await mintReviewToken("some-other-secret-bbbbbbbbbbbbbbbbbbbb", reviewer, {
      ttlSeconds: 3600,
    });
    expect(await verifyReviewToken(secret, t)).toEqual({ ok: false });
  });
});

describe("isReviewAccount", () => {
  it("recognises the configured review address, case- and space-insensitively", async () => {
    const { isReviewAccount } = await import("./auth.js");
    const env = { REVIEW_ACCOUNT_EMAIL: "adaminsley+shipaso-review@gmail.com" };
    expect(isReviewAccount(env, "  ADAMINSLEY+ShipASO-Review@Gmail.com ")).toBe(true);
  });

  it("rejects every other address", async () => {
    const { isReviewAccount } = await import("./auth.js");
    const env = { REVIEW_ACCOUNT_EMAIL: "adaminsley+shipaso-review@gmail.com" };
    expect(isReviewAccount(env, "someone-else@gmail.com")).toBe(false);
  });

  it("is CLOSED when unset — no review account means no review token can ever mint", async () => {
    const { isReviewAccount } = await import("./auth.js");
    expect(isReviewAccount({}, "adaminsley+shipaso-review@gmail.com")).toBe(false);
    expect(isReviewAccount({ REVIEW_ACCOUNT_EMAIL: "  " }, "anything@x.com")).toBe(false);
  });
});

import { magicLinkMessage } from "./auth.js";

describe("magicLinkMessage — the sign-in email body", () => {
  const LINK = "https://shipaso.com/auth/m?token=abc123";

  it("carries the link in both html and text", async () => {
    const m = magicLinkMessage(LINK);
    expect(m.html).toContain(LINK);
    expect(m.text).toContain(LINK);
  });

  it("keeps the expiry warning — the link dies in 15 minutes and the reader must know", async () => {
    const m = magicLinkMessage(LINK);
    expect(m.html).toMatch(/15 minutes/);
    expect(m.text).toMatch(/15 minutes/);
  });

  it("keeps the didn't-request-it line in both parts (anti-phishing hygiene)", async () => {
    const m = magicLinkMessage(LINK);
    expect(m.html).toMatch(/didn't request/);
    expect(m.text).toMatch(/didn't request/);
  });

  it("escapes the link so a crafted token cannot inject markup", async () => {
    const m = magicLinkMessage('https://x.test/?t=a"><script>alert(1)</script>');
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&quot;");
  });

  it("says what ShipASO is — one orienting line, so a stale signup is not a mystery", async () => {
    const m = magicLinkMessage(LINK);
    expect(m.text).toMatch(/keyword|rank/i);
    expect(m.html).toMatch(/keyword|rank/i);
  });

  it("makes NO measured claim — the honesty invariant applies to marketing copy too", async () => {
    const m = magicLinkMessage(LINK);
    // No fabricated stats: no "N% more installs", no "trusted by N developers".
    expect(m.text).not.toMatch(/\d+\s*%/);
    expect(m.text).not.toMatch(/\b\d[\d,]*\s+(developers|apps|users|installs)\b/i);
    expect(m.html).not.toMatch(/\d+\s*%/);
  });

  it("keeps the credential first: the sign-in link precedes any marketing copy", async () => {
    const m = magicLinkMessage(LINK);
    const linkAt = m.text.indexOf(LINK);
    const pitchAt = m.text.search(/keyword|rank/i);
    expect(linkAt).toBeGreaterThanOrEqual(0);
    expect(pitchAt).toBeGreaterThan(linkAt);
  });

  it("stays short — a transactional email that reads as a newsletter gets filtered", async () => {
    const m = magicLinkMessage(LINK);
    expect(m.text.length).toBeLessThan(600);
  });
});

describe("approval nonces (ADR-001: the approval boundary)", () => {
  const RUN = "9f8e7d6c-1234-4a5b-8c9d-0123456789ab";
  const OTHER_RUN = "00000000-1111-4222-8333-444444444444";

  it("mints a nonce that verifies back to the same email for the same run", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce(SECRET, "User@Example.com", RUN, { now });
    await expect(verifyApprovalNonce(SECRET, nonce, RUN, { now })).resolves.toEqual({
      ok: true,
      email: "user@example.com",
    });
  });

  it("REJECTS a nonce minted for a different run — the subject is signed", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce(SECRET, "user@example.com", RUN, { now });
    await expect(verifyApprovalNonce(SECRET, nonce, OTHER_RUN, { now })).resolves.toEqual({
      ok: false,
    });
  });

  it("REJECTS a session token replayed as an approval nonce", async () => {
    const now = 1_000_000;
    const session = await mintSessionToken(SECRET, "user@example.com", { now, ttlSeconds: 3600 });
    await expect(verifyApprovalNonce(SECRET, session, RUN, { now })).resolves.toEqual({ ok: false });
  });

  it("REJECTS an approval nonce replayed as a session token", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce(SECRET, "user@example.com", RUN, { now });
    await expect(verifySessionToken(SECRET, nonce, { now })).resolves.toEqual({ ok: false });
  });

  it("REJECTS a nonce signed with a different secret", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce("some-other-secret", "user@example.com", RUN, { now });
    await expect(verifyApprovalNonce(SECRET, nonce, RUN, { now })).resolves.toEqual({ ok: false });
  });

  it("REJECTS a tampered payload", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce(SECRET, "user@example.com", RUN, { now });
    const [, sig] = nonce.split(".");
    const forged = `${btoa(JSON.stringify({ e: "attacker@example.com", x: now + 60, t: "approve", s: RUN })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${sig}`;
    await expect(verifyApprovalNonce(SECRET, forged, RUN, { now })).resolves.toEqual({ ok: false });
  });

  it("EXPIRES — a nonce is dead once its TTL has elapsed", async () => {
    const now = 1_000_000;
    const nonce = await mintApprovalNonce(SECRET, "user@example.com", RUN, { now });
    await expect(
      verifyApprovalNonce(SECRET, nonce, RUN, { now: now + APPROVAL_NONCE_TTL_SECONDS }),
    ).resolves.toEqual({ ok: false });
    // still valid one second before expiry — the boundary is exact
    await expect(
      verifyApprovalNonce(SECRET, nonce, RUN, { now: now + APPROVAL_NONCE_TTL_SECONDS - 1 }),
    ).resolves.toEqual({ ok: true, email: "user@example.com" });
  });

  it("REJECTS junk", async () => {
    const now = 1_000_000;
    for (const junk of ["", "not-a-token", "a.b.c", "onlyonepart"]) {
      await expect(verifyApprovalNonce(SECRET, junk, RUN, { now })).resolves.toEqual({ ok: false });
    }
  });
});
