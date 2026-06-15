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

type TokenKind = "magic" | "session";

type TokenPayload = {
  /** normalized (trimmed, lowercased) email */
  e: string;
  /** absolute expiry, unix seconds */
  x: number;
  /** token kind tag — binds a token to its path */
  t: TokenKind;
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
  opts: Clock & { ttlSeconds: number },
): Promise<string> {
  const payload: TokenPayload = {
    e: normalizeEmail(email),
    x: nowSeconds(opts) + opts.ttlSeconds,
    t: kind,
  };
  const encoded = encodePayload(payload);
  const sig = await hmac(secret, encoded);
  return `${encoded}.${sig}`;
}

async function verify(
  secret: string,
  token: string,
  kind: TokenKind,
  opts?: Clock,
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
    this.log(`[store-ops email] ${msg.subject} -> ${msg.to}\n${msg.text}`);
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

/** Shared magic-link email body (subject/html/text). Branding lives here so all
 *  senders stay consistent. */
export function magicLinkMessage(link: string): { subject: string; html: string; text: string } {
  const safe = escapeHtml(link);
  return {
    subject: "Your ShipASO sign-in link",
    html:
      `<p>Click to sign in to ShipASO:</p>` +
      `<p><a href="${safe}">Sign in</a></p>` +
      `<p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
    text:
      `Sign in to ShipASO:\n${link}\n\n` +
      `This link expires in 15 minutes. If you didn't request it, ignore this email.`,
  };
}

/** Split a `Name <email>` (or bare `email`) into Brevo's sender object. */
function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m && m[2]) return m[1] ? { name: m[1], email: m[2] } : { email: m[2] };
  return { email: from.trim() };
}

/**
 * Sends via Brevo (formerly Sendinblue) — POST /v3/smtp/email with the API key
 * in the `api-key` header (NOT Bearer). Brevo wants a structured sender
 * ({name,email}) + to ([{email}]) + htmlContent/textContent, so the shared
 * `from` string is parsed into its object form. `fetchFn` injected for tests.
 */
export class BrevoEmailSender implements EmailSender {
  readonly channel = "brevo";
  private readonly apiKey: string;
  private readonly sender: { name?: string; email: string };
  private readonly fetchFn: typeof fetch;

  constructor(opts: { apiKey: string; from: string; fetchFn?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.sender = parseSender(opts.from);
    // Bind to globalThis (same Workers "Illegal invocation" guard as Resend).
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  }

  async send(msg: EmailMessage): Promise<void> {
    const resp = await this.fetchFn("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`brevo send failed (${resp.status}): ${detail}`);
    }
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    await this.send({ to: email, ...magicLinkMessage(link) });
  }
}
