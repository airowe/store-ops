/**
 * Passwordless magic-link + session auth primitives.
 *
 * Both token kinds are the same shape: a base64url(JSON payload) joined to a
 * base64url(HMAC-SHA256(payload, SESSION_SECRET)) by a dot — `payload.sig`. The
 * payload carries the (normalized) email `e`, an absolute expiry `x` (unix
 * seconds), and a kind tag `t` ("magic" | "session") so a magic-link token can
 * never be replayed as a session and vice-versa. Verification recomputes the
 * HMAC, compares it in constant time, then checks the expiry — so a tampered
 * payload (or one signed with a different secret) is rejected before we trust the
 * email.
 *
 * All crypto is Web Crypto (`crypto.subtle`), present in both the Workers runtime
 * and the node test environment — no node: built-ins, no extra deps.
 *
 * "Sending" the link goes through the `EmailSender` interface; the default
 * `ConsoleEmailSender` just logs it, so auth works with NO email vendor wired up.
 * A Resend/Postmark impl can be dropped in later behind the same interface.
 */

export const SESSION_COOKIE = "store_ops_session";

/** Fallback secret used ONLY in the demo env when SESSION_SECRET is unset. */
const DEV_FALLBACK_SECRET = "store-ops-dev-insecure-secret-do-not-use-in-prod";

type TokenKind = "magic" | "session" | "unsub" | "list-unsub" | "review" | "approve";

type TokenPayload = {
  /** normalized (trimmed, lowercased) email */
  e: string;
  /** absolute expiry, unix seconds */
  x: number;
  /** token kind tag — binds a token to its path */
  t: TokenKind;
  /**
   * Optional SUBJECT the token is bound to (approval nonces: the run id). A
   * nonce minted for run A must never spend on run B, so the subject is inside
   * the signed payload rather than alongside it.
   */
  s?: string;
};

export type VerifyResult = { ok: true; email: string } | { ok: false };

type Clock = { now?: number };

/** unix seconds for "now" (overridable in tests for deterministic expiry). */
function nowSeconds(opts?: Clock): number {
  return opts?.now ?? Math.floor(Date.now() / 1000);
}

// ── base64url (no padding) ─────────────────────────────────────────────────────

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

function encodePayload(payload: TokenPayload): string {
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
}

// ── HMAC-SHA256 (Web Crypto) ────────────────────────────────────────────────────

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64url(new Uint8Array(sig));
}

/**
 * Length-stable, constant-time string compare. We always walk the FULL length of
 * the expected value so timing doesn't leak how many leading chars matched; a
 * length mismatch still returns false (but only after a fixed-cost compare).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ── mint / verify ───────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function mint(
  secret: string,
  email: string,
  kind: TokenKind,
  opts: Clock & { ttlSeconds: number; subject?: string },
): Promise<string> {
  const payload: TokenPayload = {
    e: normalizeEmail(email),
    x: nowSeconds(opts) + opts.ttlSeconds,
    t: kind,
    ...(opts.subject !== undefined ? { s: opts.subject } : {}),
  };
  const encoded = encodePayload(payload);
  const sig = await hmac(secret, encoded);
  return `${encoded}.${sig}`;
}

async function verify(
  secret: string,
  token: string,
  kind: TokenKind,
  opts?: Clock & { subject?: string },
): Promise<VerifyResult> {
  if (typeof token !== "string" || !token) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [encoded, sig] = parts;
  if (!encoded || !sig) return { ok: false };

  // recompute + constant-time compare the signature BEFORE trusting the payload
  const expected = await hmac(secret, encoded);
  if (!constantTimeEqual(sig, expected)) return { ok: false };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlToString(encoded)) as TokenPayload;
  } catch {
    return { ok: false };
  }
  if (payload.t !== kind) return { ok: false };
  if (typeof payload.e !== "string" || typeof payload.x !== "number") return { ok: false };
  // Subject binding: when the caller names a subject, the token MUST carry the
  // same one. A nonce minted for run A is therefore invalid on run B.
  if (opts?.subject !== undefined) {
    if (typeof payload.s !== "string") return { ok: false };
    if (!constantTimeEqual(payload.s, opts.subject)) return { ok: false };
  }
  if (nowSeconds(opts) >= payload.x) return { ok: false };
  return { ok: true, email: payload.e };
}

export function mintMagicToken(
  secret: string,
  email: string,
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  return mint(secret, email, "magic", opts);
}

export function verifyMagicToken(
  secret: string,
  token: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "magic", opts);
}

export function mintSessionToken(
  secret: string,
  email: string,
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  return mint(secret, email, "session", opts);
}

export function verifySessionToken(
  secret: string,
  token: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "session", opts);
}

/**
 * Unsubscribe tokens (comms-prefs Phase 2) — the credential inside the digest
 * email's unsubscribe link. Audience-separated ("unsub"): it can never pass as
 * a session or magic token and vice versa. Long-lived (the caller passes ~60d)
 * because a fresh one ships with every weekly digest anyway; scoped to ONE
 * action (digest off) at the API layer.
 */
export function mintUnsubToken(
  secret: string,
  email: string,
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  return mint(secret, email, "unsub", opts);
}

export function verifyUnsubToken(
  secret: string,
  token: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "unsub", opts);
}

/**
 * List-unsubscribe tokens for the launch/newsletter broadcast list. A SEPARATE
 * audience from the digest `unsub` token (subscribers are not users), so a
 * broadcast unsub link can never flip a user's digest pref or pass as a session.
 */
export function mintListUnsubToken(
  secret: string,
  email: string,
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  return mint(secret, email, "list-unsub", opts);
}

export function verifyListUnsubToken(
  secret: string,
  token: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "list-unsub", opts);
}

/**
 * App Review sign-in tokens (Guideline 2.1(a), 2026-08 rejection).
 *
 * WHY THIS EXISTS: sign-in is passwordless, so the only way in is a magic link
 * mailed to an inbox. App Review has no access to our mailbox, and magic tokens
 * live 15 minutes — too short to write into review notes. The 0.1.1 reviewer was
 * left on the "link is on its way" screen and rejected the build. This is the
 * credential that is durable enough to PUT IN THE NOTES.
 *
 * The trade is deliberate: a long-lived bearer credential sitting in a document.
 * Three things bound the blast radius —
 *   1. Audience-separated ("review"): it is not a session. It must be exchanged,
 *      and it can never be replayed as one.
 *   2. It only ever mints a session for `REVIEW_ACCOUNT_EMAIL` — the route checks
 *      `isReviewAccount` on the verified email and refuses everything else, so a
 *      leaked token cannot be re-pointed at a real customer.
 *   3. That account is a free-tier account holding no store credentials and no
 *      payment method, so the session it yields can reach nothing worth stealing.
 * Rotate it by changing SESSION_SECRET or REVIEW_ACCOUNT_EMAIL; both invalidate
 * every outstanding review token immediately.
 */
export function mintReviewToken(
  secret: string,
  email: string,
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  return mint(secret, email, "review", opts);
}

export function verifyReviewToken(
  secret: string,
  token: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "review", opts);
}

/**
 * Is `email` the configured App Review account? FAIL-CLOSED: an unset or blank
 * `REVIEW_ACCOUNT_EMAIL` means NO address qualifies, so the review path is off
 * by default and cannot be enabled by accident. Comparison is on the same
 * normalized form the tokens carry.
 */
export function isReviewAccount(
  env: { REVIEW_ACCOUNT_EMAIL?: string },
  email: string,
): boolean {
  const configured = env.REVIEW_ACCOUNT_EMAIL?.trim();
  if (!configured) return false;
  return normalizeEmail(configured) === normalizeEmail(email);
}

// ── cookies ─────────────────────────────────────────────────────────────────────

export type SameSite = "Lax" | "Strict" | "None";

/** Shared cookie attributes. `None` forces `Secure` (browsers require it). */
type CookieOpts = { sameSite?: SameSite; domain?: string };

function cookieAttrs(opts: CookieOpts): string[] {
  const sameSite = opts.sameSite ?? "Lax";
  const attrs = ["Path=/", "HttpOnly", "Secure", `SameSite=${sameSite}`];
  if (opts.domain) attrs.push(`Domain=${opts.domain}`);
  return attrs;
}

/**
 * Serialize the session cookie. Defaults to SameSite=Lax with no Domain (single
 * origin). For a split dashboard↔API across sibling subdomains (app.shipaso.com
 * ↔ api.shipaso.com) pass `sameSite:"None"` + `domain:".shipaso.com"` so the
 * cookie is shared and sent on cross-site fetch (with credentials).
 */
export function serializeSessionCookie(
  token: string,
  opts: { maxAgeSeconds: number } & CookieOpts,
): string {
  return [`${SESSION_COOKIE}=${token}`, ...cookieAttrs(opts), `Max-Age=${opts.maxAgeSeconds}`].join(
    "; ",
  );
}

/**
 * A cookie that clears the session. Must carry the SAME Domain/SameSite the
 * session was set with, or the browser keeps the original cookie.
 */
export function serializeLogoutCookie(opts: CookieOpts = {}): string {
  return [`${SESSION_COOKIE}=`, ...cookieAttrs(opts), "Max-Age=0"].join("; ");
}

/** Parse a Cookie request header into a name→value jar. Tolerant of null/empty. */
export function parseCookie(header: string | null): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

// ── secret resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the signing secret. In demo, an unset secret falls back to a fixed dev
 * value (with a loud console warning) so the working demo never breaks. Outside
 * demo, an unset secret is a hard error — we will not sign tokens with a secret
 * everyone knows in production.
 */
export function resolveSessionSecret(
  configured: string | undefined,
  appEnv: string,
): string {
  if (configured && configured.length > 0) return configured;
  if (appEnv === "demo") {
    console.warn(
      "[store-ops auth] SESSION_SECRET unset — using insecure dev fallback (demo only). " +
        "Set SESSION_SECRET via `wrangler secret put SESSION_SECRET` before production.",
    );
    return DEV_FALLBACK_SECRET;
  }
  throw new Error("SESSION_SECRET is required outside the demo environment");
}

// ── email delivery ───────────────────────────────────────────────────────────────

/** A fully-composed message handed to the transport. The caller owns formatting. */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional RFC-style message headers (e.g. List-Unsubscribe / -Post for the
   * digest, comms-prefs Phase 2). Senders that support custom headers pass them
   * through; Console logs them.
   */
  headers?: Record<string, string>;
};

/**
 * Pluggable email delivery. Swap in a Resend/Postmark impl behind this.
 *
 * `send` is the generic primitive — any email type (magic link, weekly digest,
 * future receipts) composes its own subject/html/text and hands it here, so the
 * transport never knows about ranks or links. `sendMagicLink` stays as a thin,
 * stable convenience for the auth flow and is expressed in terms of `send`.
 */
export type EmailSender = {
  /** human-readable channel name, surfaced for diagnostics. */
  readonly channel: string;
  send(msg: EmailMessage): Promise<void>;
  sendMagicLink(email: string, link: string): Promise<void>;
};

/**
 * The default sender: logs the magic link instead of emailing it. Lets the whole
 * auth flow work with NO email vendor configured (dev/demo). A real sender
 * implements the same interface and is selected via env later.
 */
export class ConsoleEmailSender implements EmailSender {
  readonly channel = "console";
  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = (line) => console.log(line)) {
    this.log = log;
  }

  async send(msg: EmailMessage): Promise<void> {
    const hdrs = msg.headers ? ` headers=${JSON.stringify(msg.headers)}` : "";
    this.log(`[store-ops email] ${msg.subject} -> ${msg.to}${hdrs}\n${msg.text}`);
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    this.log(`[store-ops auth] magic link for ${email}: ${link}`);
  }
}

/** Minimal HTML escape for interpolating a URL into the email markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sends the magic link via Resend (https://resend.com) — a single POST to
 * /emails with the API key as a Bearer token. `fetchFn` is injected so it's
 * unit-testable without a network; production passes the global `fetch`.
 *
 * A non-2xx response throws, so POST /auth/request can decide how to surface a
 * delivery failure (today it logs; it never leaks account existence to the user).
 */
export class ResendEmailSender implements EmailSender {
  readonly channel = "resend";
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { apiKey: string; from: string; fetchFn?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    // Bind to globalThis: calling the global `fetch` as a method (this.fetchFn)
    // strips its binding and throws "Illegal invocation" in Workers. An injected
    // (test) fetchFn is used as-is.
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  }

  /** The generic transport: one POST to Resend's /emails. Throws on non-2xx. */
  async send(msg: EmailMessage): Promise<void> {
    const resp = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`resend send failed (${resp.status}): ${detail}`);
    }
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    await this.send({ to: email, ...magicLinkMessage(link) });
  }
}

/**
 * Shared magic-link email body (subject/html/text). Branding lives here so all
 * senders stay consistent.
 *
 * This is a TRANSACTIONAL email carrying a security credential, and the ordering
 * below is deliberate: the link comes first, the orienting line comes after. A
 * sign-in mail that reads as a newsletter is both worse at its job (the reader
 * hunts for the button) and likelier to be filtered — and the one email that
 * MUST arrive is the one you cannot afford in a spam folder.
 *
 * The one-line description exists because sign-in can happen weeks after signup
 * and "what is ShipASO?" is a real reaction. It says what the product does and
 * makes NO measured claim: no percentages, no "trusted by N developers". The
 * measured-or-nothing invariant governs marketing copy exactly as it governs the
 * dashboard — a number we cannot measure does not get written down, and a
 * fabricated one in an email is no cheaper than a fabricated one in a report.
 */
export function magicLinkMessage(link: string): { subject: string; html: string; text: string } {
  const safe = escapeHtml(link);
  const tagline =
    "ShipASO tracks where your app really ranks for the keywords that matter, " +
    "and proposes the fix.";
  return {
    subject: "Your ShipASO sign-in link",
    html:
      `<p>Click to sign in to ShipASO:</p>` +
      `<p><a href="${safe}">Sign in</a></p>` +
      `<p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>` +
      `<hr>` +
      `<p><small>${tagline} Every number it shows is measured, or it is marked ` +
      `unmeasured — never a guess.</small></p>`,
    text:
      `Sign in to ShipASO:\n${link}\n\n` +
      `This link expires in 15 minutes. If you didn't request it, ignore this email.\n\n` +
      `--\n${tagline} Every number it shows is measured, or it is marked ` +
      `unmeasured — never a guess.`,
  };
}

// ── approval nonces (WebMCP approval boundary, ADR-001) ─────────────────────────

/**
 * An APPROVAL NONCE proves a human gesture happened in the page.
 *
 * The problem it solves: a browser agent runs in the page with the user's own
 * session, so withholding a WebMCP tool does not remove the capability to POST
 * an approval — it only declines to advertise it. A nonce that can only be
 * minted from a `isTrusted` DOM event (which scripted fetch cannot forge) makes
 * "only a human approves" a property of the system rather than a promise about
 * what we expose.
 *
 * Shape reuses the magic-link/session token exactly (HMAC-SHA256 over a
 * base64url JSON payload, `payload.sig`), with two additions:
 *   • kind tag "approve" — a session token can never be spent as a nonce, and a
 *     nonce can never be replayed as a session (the existing `t` guarantee).
 *   • subject `s` = the run id — a nonce minted for run A is invalid on run B.
 *
 * NOT single-use by itself: a stateless token is replayable inside its TTL. The
 * domain already closes this — `approvals` is UNIQUE (run_id) and decideRun
 * 409s on an existing decision, so a replay hits an idempotency wall that
 * predates this mechanism. The TTL is short because a nonce is minted by a
 * click and spent immediately.
 */
export const APPROVAL_NONCE_TTL_SECONDS = 60;

export function mintApprovalNonce(
  secret: string,
  email: string,
  runId: string,
  opts?: Clock & { ttlSeconds?: number },
): Promise<string> {
  return mint(secret, email, "approve", {
    ...opts,
    ttlSeconds: opts?.ttlSeconds ?? APPROVAL_NONCE_TTL_SECONDS,
    subject: runId,
  });
}

export function verifyApprovalNonce(
  secret: string,
  token: string,
  runId: string,
  opts?: Clock,
): Promise<VerifyResult> {
  return verify(secret, token, "approve", { ...opts, subject: runId });
}
