# Launch-list Broadcast Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner send launch/newsletter emails to the D1 `subscribers` list, with one-click unsubscribe + suppression, via an owner-only dashboard page.

**Architecture:** Reuse the existing `EmailSender` (Brevo/Resend) and the HMAC token pattern (`mint`/`verify`). Add a `list-unsub` token audience, a suppression column + audit table, owner-token-gated `/broadcast/*` endpoints that send in `ctx.waitUntil` chunks, public `/list/unsubscribe` routes, and a `/broadcast` React page.

**Tech Stack:** Cloudflare Worker + D1 (TypeScript), Vitest, React 19 + TanStack Router (web).

## Global Constraints

- **Owner auth (degrade closed):** `BROADCAST_TOKEN` env var; requests present `x-broadcast-token`; unset OR mismatch → **403**. Mirrors the RLHF export gate (`preferenceDataExport`).
- **Never return subscriber addresses to the browser** — only counts and send results.
- **Compliance:** every broadcast email carries a one-click `List-Unsubscribe` + `List-Unsubscribe-Post` header AND a visible footer link, both pointing at the same signed-token URL.
- **Token audience separation:** the new `list-unsub` token must never verify as `magic`, `session`, or `unsub` (the `verify` function already enforces `payload.t !== kind`).
- **Send never blocks the request:** `/broadcast/send` returns immediately; sending happens in `ctx.waitUntil` in chunks of 20 with a delay between chunks; per-email failures are caught + logged; the sent/total count is logged so a truncation is visible.
- **Two-step safety:** a real send requires `confirm === true`; the UI requires a test-to-self + an explicit confirm checkbox first.
- **Existing helpers to reuse (exact names):** `sessionSecret(env)` (cloud/src/api/index.ts:551), `emailSenderForEnv(env)` (cloud/src/emailSender.ts:16), `mintUnsubToken`/`verifyUnsubToken` style (cloud/src/auth.ts:184/192), `htmlPage(...)` + `escapeHtmlText(...)` (used by `unsubscribeGetRoute`), `recordSubscriber` neighbor style in cloud/src/d1.ts.
- **D1 access in handlers:** `env.DB` (a `D1Database`).

---

### Task 1: `list-unsub` token audience

Add a fourth token kind so broadcast unsubscribe links are signed + audience-separated, exactly like the digest `unsub` token.

**Files:**
- Modify: `cloud/src/auth.ts` (the `TokenKind` union at line 26; add mint/verify wrappers near line 184)
- Test: `cloud/src/auth.spec.ts` (add cases)

**Interfaces:**
- Consumes: existing `mint`/`verify` (private), `Clock`, `VerifyResult`.
- Produces: `mintListUnsubToken(secret: string, email: string, opts: {now?: number; ttlSeconds: number}): Promise<string>` and `verifyListUnsubToken(secret: string, token: string, opts?: {now?: number}): Promise<VerifyResult>` (`VerifyResult = {ok:true;email:string} | {ok:false}`).

- [ ] **Step 1: Write the failing test.** Append to `cloud/src/auth.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it, expect FAIL** (`mintListUnsubToken` not exported).

Run: `cd cloud && npx vitest run src/auth.spec.ts`
Expected: FAIL — no `mintListUnsubToken` export.

- [ ] **Step 3: Extend the token kind + add wrappers.** In `cloud/src/auth.ts`, change line 26:

```ts
type TokenKind = "magic" | "session" | "unsub" | "list-unsub";
```

Then add, right after `verifyUnsubToken` (near line 195):

```ts
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
```

- [ ] **Step 4: Run it, expect PASS.**

Run: `cd cloud && npx vitest run src/auth.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add cloud/src/auth.ts cloud/src/auth.spec.ts
git commit -m "feat(auth): list-unsub token audience for the broadcast list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: schema + D1 helpers (suppression, counts, audit)

Add the suppression column, the `broadcasts` audit table, and the D1 helpers the endpoints use.

**Files:**
- Modify: `cloud/schema.sql` (the `subscribers` block ~line 289; add `broadcasts` after it)
- Modify: `cloud/src/d1.ts` (near `recordSubscriber`, ~line 653)
- Test: `cloud/src/d1.spec.ts` (create if absent, else append) — use a fake D1 like other specs

**Interfaces:**
- Consumes: `env.DB` (`D1Database`), `uuid()` (already imported in d1.ts).
- Produces:
  - `activeSubscribers(db: D1Database): Promise<{ email: string }[]>` — rows where `unsubscribed_at IS NULL`.
  - `subscriberCounts(db: D1Database): Promise<{ active: number; unsubscribed: number }>`.
  - `unsubscribeSubscriber(db: D1Database, email: string): Promise<void>` — sets `unsubscribed_at`, non-creating, idempotent.
  - `recordBroadcast(db: D1Database, m: { subject: string; recipientCount: number; sender: string | null }): Promise<string>` — inserts, returns id.

- [ ] **Step 1: Write the failing test.** Create/append `cloud/src/d1.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeSubscribers, subscriberCounts, unsubscribeSubscriber, recordBroadcast, recordSubscriber } from "./d1.js";

// Minimal in-memory D1 shim: enough for these four helpers.
function fakeDb() {
  const subs: { id: string; email: string; source: string | null; unsubscribed_at: string | null }[] = [];
  const broadcasts: unknown[] = [];
  const api = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async run() {
          if (/^INSERT OR IGNORE INTO subscribers/i.test(s)) {
            const [id, email, source] = bound as string[];
            if (!subs.find((r) => r.email === email)) subs.push({ id, email, source, unsubscribed_at: null });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE subscribers SET unsubscribed_at/i.test(s)) {
            const email = bound[0] as string;
            const row = subs.find((r) => r.email === email);
            if (row && !row.unsubscribed_at) row.unsubscribed_at = "2026-01-01T00:00:00Z";
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO broadcasts/i.test(s)) { broadcasts.push(bound); return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          if (/FROM subscribers WHERE unsubscribed_at IS NULL/i.test(s)) {
            return { results: subs.filter((r) => !r.unsubscribed_at).map((r) => ({ email: r.email })) as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (/COUNT/i.test(s) && /unsubscribed_at IS NULL/i.test(s)) {
            return { active: subs.filter((r) => !r.unsubscribed_at).length,
                     unsubscribed: subs.filter((r) => r.unsubscribed_at).length } as T;
          }
          return null;
        },
      };
      return stmt;
    },
  };
  return api as unknown as import("@cloudflare/workers-types").D1Database;
}

describe("subscriber list helpers", () => {
  it("activeSubscribers excludes suppressed rows; counts split active/unsubscribed", async () => {
    const db = fakeDb();
    await recordSubscriber(db, "a@x.com", "landing");
    await recordSubscriber(db, "b@x.com", "landing");
    await unsubscribeSubscriber(db, "b@x.com");
    expect(await activeSubscribers(db)).toEqual([{ email: "a@x.com" }]);
    expect(await subscriberCounts(db)).toEqual({ active: 1, unsubscribed: 1 });
  });

  it("unsubscribeSubscriber is idempotent (second call no-throws)", async () => {
    const db = fakeDb();
    await recordSubscriber(db, "a@x.com", "landing");
    await unsubscribeSubscriber(db, "a@x.com");
    await unsubscribeSubscriber(db, "a@x.com");
    expect(await subscriberCounts(db)).toEqual({ active: 0, unsubscribed: 1 });
  });

  it("recordBroadcast returns an id", async () => {
    const db = fakeDb();
    const id = await recordBroadcast(db, { subject: "Launch", recipientCount: 3, sender: "owner" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (helpers not exported).

Run: `cd cloud && npx vitest run src/d1.spec.ts`
Expected: FAIL — imports not found.

- [ ] **Step 3: Add the schema.** In `cloud/schema.sql`, replace the `subscribers` CREATE block with one that includes the column, and add `broadcasts` right after it:

```sql
CREATE TABLE IF NOT EXISTS subscribers (
  id              TEXT PRIMARY KEY,                       -- uuid
  email           TEXT NOT NULL UNIQUE,
  source          TEXT,                                   -- where they signed up (e.g. 'landing')
  unsubscribed_at TEXT,                                   -- null = active; timestamp = suppressed
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── broadcasts ───────────────────────────────────────────────────────────────
-- Audit row per launch/newsletter send. A broadcast is a recorded event, so a
-- partial send (ctx.waitUntil truncation) is visible and never silent.
-- Migration for an existing db:
--   npx wrangler d1 execute store_ops --command "ALTER TABLE subscribers ADD COLUMN unsubscribed_at TEXT"
--   npx wrangler d1 execute store_ops --command "CREATE TABLE IF NOT EXISTS broadcasts (id TEXT PRIMARY KEY, subject TEXT NOT NULL, recipient_count INTEGER NOT NULL, sender TEXT, sent_at TEXT NOT NULL DEFAULT (datetime('now')))"
CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  sender          TEXT,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Add the D1 helpers.** In `cloud/src/d1.ts`, after `recordSubscriber` (~line 664):

```ts
/** Active (non-suppressed) subscriber emails — the broadcast recipients. */
export async function activeSubscribers(db: D1Database): Promise<{ email: string }[]> {
  const { results } = await db
    .prepare("SELECT email FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at")
    .all<{ email: string }>();
  return results ?? [];
}

/** Split counts for the broadcast UI — never returns addresses. */
export async function subscriberCounts(db: D1Database): Promise<{ active: number; unsubscribed: number }> {
  const row = await db
    .prepare(
      "SELECT " +
        "SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS active, " +
        "SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed " +
        "FROM subscribers",
    )
    .first<{ active: number | null; unsubscribed: number | null }>();
  return { active: row?.active ?? 0, unsubscribed: row?.unsubscribed ?? 0 };
}

/** Suppress an address (one-click list unsubscribe). Non-creating, idempotent. */
export async function unsubscribeSubscriber(db: D1Database, email: string): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET unsubscribed_at = datetime('now') WHERE email = ? AND unsubscribed_at IS NULL")
    .bind(email.trim().toLowerCase())
    .run();
}

/** Record a broadcast send (audit). Returns the new row id. */
export async function recordBroadcast(
  db: D1Database,
  m: { subject: string; recipientCount: number; sender: string | null },
): Promise<string> {
  const id = uuid();
  await db
    .prepare("INSERT INTO broadcasts (id, subject, recipient_count, sender) VALUES (?, ?, ?, ?)")
    .bind(id, m.subject, m.recipientCount, m.sender)
    .run();
  return id;
}
```

Note: the test's fake `first()` returns numbers directly for the COUNT query — the real `subscriberCounts` handles `null` via `?? 0`, so both the fake and real D1 pass.

- [ ] **Step 5: Run it, expect PASS.**

Run: `cd cloud && npx vitest run src/d1.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add cloud/schema.sql cloud/src/d1.ts cloud/src/d1.spec.ts
git commit -m "feat(d1): subscriber suppression + broadcasts audit table + helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `renderBroadcast` — markdown → {html, text}

A tiny, dependency-free markdown renderer (no md library exists in the repo). Handles what a launch email needs: headings, paragraphs, bold, links, unordered lists. Escapes HTML. The same function feeds both the email and the UI preview.

**Files:**
- Create: `cloud/src/broadcast.ts`
- Test: `cloud/src/broadcast.spec.ts`

**Interfaces:**
- Produces: `renderBroadcast(subject: string, markdown: string): { html: string; text: string }`. `html` is a full standalone email body (escaped, minimal inline styles); `text` is a plaintext fallback (markdown stripped).

- [ ] **Step 1: Write the failing test.** Create `cloud/src/broadcast.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderBroadcast } from "./broadcast.js";

describe("renderBroadcast", () => {
  it("renders headings, paragraphs, bold, links, and lists to html", () => {
    const { html } = renderBroadcast("Launch", "# Hi\n\nWe **shipped**. See [docs](https://x.com).\n\n- one\n- two");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<strong>shipped</strong>");
    expect(html).toContain('<a href="https://x.com">docs</a>');
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("escapes HTML in the source (no injection)", () => {
    const { html } = renderBroadcast("x", "hi <script>alert(1)</script> & <b>x</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("produces a plaintext part with markup stripped", () => {
    const { text } = renderBroadcast("x", "# Hi\n\nWe **shipped**. [docs](https://x.com)");
    expect(text).toContain("Hi");
    expect(text).toContain("shipped");
    expect(text).toContain("https://x.com");
    expect(text).not.toContain("**");
    expect(text).not.toContain("# ");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `cd cloud && npx vitest run src/broadcast.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer.** Create `cloud/src/broadcast.ts`:

```ts
/**
 * Minimal, dependency-free markdown → {html, text} for launch/newsletter emails.
 * Supports: # / ## / ### headings, blank-line-separated paragraphs, **bold**,
 * [text](url) links, and - unordered lists. Everything is HTML-escaped first, so
 * source markdown can never inject markup. Not a general markdown engine — just
 * what a broadcast needs (YAGNI). The send engine and the UI preview share this.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  // escape first, then re-introduce ONLY our whitelisted inline markup
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function renderBroadcast(subject: string, markdown: string): { html: string; text: string } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list.length) { blocks.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = []; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^-\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); const n = h[1].length; blocks.push(`<h${n}>${inline(h[2])}</h${n}>`); }
    else if (li) { flushPara(); list.push(li[1]); }
    else if (line.trim() === "") { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();

  const body = blocks.join("\n");
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;` +
    `max-width:560px;margin:0 auto;padding:24px;color:#1a1d24;line-height:1.55">${body}</body></html>`;

  // plaintext: strip our markup
  const text = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^-\s+/gm, "• ")
    .trim();

  return { html, text };
}
```

- [ ] **Step 4: Run it, expect PASS.**

Run: `cd cloud && npx vitest run src/broadcast.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add cloud/src/broadcast.ts cloud/src/broadcast.spec.ts
git commit -m "feat(broadcast): dependency-free markdown renderer for emails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: thread `ctx` into `handleApi`

`ctx.waitUntil` is not reachable in handlers today (the fetch handler discards `_ctx`). Thread it through additively — every existing handler ignores the new arg.

**Files:**
- Modify: `cloud/src/index.ts` (fetch handler ~line 134)
- Modify: `cloud/src/api/index.ts` (`handleApi` signature ~line 3725)
- Test: covered by Task 6's send test (no standalone test — this is a signature plumb).

**Interfaces:**
- Produces: `handleApi(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response>`. `ctx` optional so existing `handleApi(req, env)` test calls (e.g. `authCallback.spec.ts`) keep compiling.

- [ ] **Step 1: Change the fetch handler.** In `cloud/src/index.ts`, replace the fetch handler body:

```ts
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleApi(request, env, ctx);
  },
```

- [ ] **Step 2: Change the `handleApi` signature.** In `cloud/src/api/index.ts`, find `export async function handleApi(req: Request, env: Env): Promise<Response> {` (line ~3725) and change to:

```ts
export async function handleApi(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
```

- [ ] **Step 3: Typecheck — nothing else should break** (ctx is optional, unused so far).

Run: `cd cloud && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the existing handler specs to confirm the 2-arg callers still pass.**

Run: `cd cloud && npx vitest run src/api/authCallback.spec.ts src/api/previewUpstreamError.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add cloud/src/index.ts cloud/src/api/index.ts
git commit -m "refactor(api): thread ExecutionContext into handleApi (for waitUntil)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/list/unsubscribe` routes (public, token-gated)

Public GET confirm + POST flip, mirroring the digest `/email/unsubscribe` routes but using the `list-unsub` token and `unsubscribeSubscriber`.

**Files:**
- Modify: `cloud/src/api/index.ts` (add two route handlers + wire the routes near the existing `email`/`unsubscribe` block)
- Test: `cloud/src/api/listUnsubscribe.spec.ts`

**Interfaces:**
- Consumes: `verifyListUnsubToken` (Task 1), `unsubscribeSubscriber` (Task 2), `sessionSecret(env)`, `htmlPage`, `escapeHtmlText`.
- Produces: routing for `GET /list/unsubscribe?token=…` (confirm page, never mutates) and `POST /list/unsubscribe?token=…` (flip → `unsubscribeSubscriber`, idempotent).

- [ ] **Step 1: Write the failing test.** Create `cloud/src/api/listUnsubscribe.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleApi } from "./index.js";
import { mintListUnsubToken } from "../auth.js";
import type { Env } from "../index.js";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function envWith(onUpdate: (email: string) => void): Env {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { bound = a; return stmt; },
        async run() {
          if (/UPDATE subscribers SET unsubscribed_at/i.test(sql)) onUpdate(String(bound[0]));
          return { meta: { changes: 1 } };
        },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
      return stmt;
    },
  };
  return { SESSION_SECRET: SECRET, DB: db } as unknown as Env;
}

function req(method: string, token: string): Request {
  return new Request(`https://api.shipaso.com/list/unsubscribe?token=${encodeURIComponent(token)}`, { method });
}

describe("GET/POST /list/unsubscribe", () => {
  it("GET renders a confirm page and does NOT mutate", async () => {
    const updated: string[] = [];
    const env = envWith((e) => updated.push(e));
    const token = await mintListUnsubToken(SECRET, "me@x.com", { ttlSeconds: 3600 });
    const res = await handleApi(req("GET", token), env);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("unsubscribe");
    expect(updated).toEqual([]); // GET never mutates
  });

  it("POST flips the suppression for the token's email", async () => {
    const updated: string[] = [];
    const env = envWith((e) => updated.push(e));
    const token = await mintListUnsubToken(SECRET, "me@x.com", { ttlSeconds: 3600 });
    const res = await handleApi(req("POST", token), env);
    expect(res.status).toBe(200);
    expect(updated).toEqual(["me@x.com"]);
  });

  it("rejects a bad/expired token with 400 and no mutation", async () => {
    const updated: string[] = [];
    const env = envWith((e) => updated.push(e));
    const res = await handleApi(req("POST", "not-a-token"), env);
    expect(res.status).toBe(400);
    expect(updated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (route not wired).

Run: `cd cloud && npx vitest run src/api/listUnsubscribe.spec.ts`
Expected: FAIL — 404/unhandled.

- [ ] **Step 3: Add the handlers.** In `cloud/src/api/index.ts`, add near `unsubscribeGetRoute` (import `verifyListUnsubToken` + `unsubscribeSubscriber` at the top imports):

```ts
async function listUnsubGetRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyListUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  const email = escapeHtmlText(res.email);
  return htmlPage(
    "Unsubscribe from ShipASO updates?",
    `<h1 style="font-size:22px;margin:0 0 10px">Unsubscribe?</h1>` +
      `<p style="color:#97a1b6">This stops launch + product update emails to <strong style="color:#eef1f7">${email}</strong>.</p>` +
      `<form method="post" action="${escapeHtmlText(url.pathname + url.search)}">` +
      `<button type="submit" style="background:#34d399;color:#07090e;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer">Unsubscribe</button>` +
      `</form>`,
  );
}

async function listUnsubPostRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyListUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  await unsubscribeSubscriber(env.DB, res.email);
  return htmlPage("Unsubscribed", `<h1 style="font-size:22px;margin:0 0 10px">You're unsubscribed.</h1><p style="color:#97a1b6">You won't get further ShipASO update emails.</p>`, 200);
}
```

- [ ] **Step 4: Wire the routes.** In the routing section of `handleApi`, add (near the existing `email`/`unsubscribe` block):

```ts
    if (seg[0] === "list" && seg[1] === "unsubscribe" && seg.length === 2) {
      if (method === "GET") return listUnsubGetRoute(req, env);
      if (method === "POST") return listUnsubPostRoute(req, env);
    }
```

- [ ] **Step 5: Run it, expect PASS.**

Run: `cd cloud && npx vitest run src/api/listUnsubscribe.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add cloud/src/api/index.ts cloud/src/api/listUnsubscribe.spec.ts
git commit -m "feat(api): public /list/unsubscribe (GET confirm, POST flip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `/broadcast/*` owner-gated endpoints + chunked send

The core: token-gated counts/test/send, with the `ctx.waitUntil` chunked sender that stamps each email with a `List-Unsubscribe` header + footer link.

**Files:**
- Modify: `cloud/src/index.ts` (add `BROADCAST_TOKEN?: string;` to the `Env` interface, near `RLHF_EXPORT_TOKEN` line ~103)
- Modify: `cloud/src/broadcast.ts` (add the send engine)
- Modify: `cloud/src/api/index.ts` (add `requireBroadcastToken` + three route handlers + wiring)
- Test: `cloud/src/api/broadcast.spec.ts`

**Interfaces:**
- Consumes: `renderBroadcast` (Task 3), `activeSubscribers`/`subscriberCounts`/`recordBroadcast` (Task 2), `mintListUnsubToken` (Task 1), `emailSenderForEnv`, `sessionSecret`, `ctx` (Task 4).
- Produces:
  - `sendBroadcastToList(args: { env: Env; subject: string; markdown: string; recipients: {email:string}[]; baseUrl: string }): Promise<{ sent: number; failed: number }>` in `broadcast.ts` — the chunked sender (called inside `ctx.waitUntil`; also directly awaitable in tests).
  - Routes: `GET /broadcast/subscribers` → `{active,unsubscribed}`; `POST /broadcast/test {subject,markdown,to}` → `{ok:true}` (sends 1); `POST /broadcast/send {subject,markdown,confirm}` → `{ok:true, queued:N}`.

- [ ] **Step 1: Write the failing test.** Create `cloud/src/api/broadcast.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

const TOKEN = "owner-secret-token";

// Fake EmailSender captured via a module mock.
const sent: { to: string; subject: string; headers?: Record<string, string> }[] = [];
vi.mock("../emailSender.js", () => ({
  emailSenderForEnv: () => ({
    channel: "fake",
    async send(msg: { to: string; subject: string; headers?: Record<string, string> }) { sent.push(msg); },
    async sendMagicLink() {},
  }),
}));

function fakeDb(activeEmails: string[]) {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() { return stmt; },
        async run() { return { meta: { changes: 1 } }; },
        async all() {
          if (/FROM subscribers WHERE unsubscribed_at IS NULL/i.test(sql)) {
            return { results: activeEmails.map((e) => ({ email: e })) };
          }
          return { results: [] };
        },
        async first() {
          if (/COUNT|SUM/i.test(sql)) return { active: activeEmails.length, unsubscribed: 0 };
          return null;
        },
      };
      return stmt;
    },
  };
}

function env(activeEmails: string[] = []): Env {
  return {
    SESSION_SECRET: "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    BROADCAST_TOKEN: TOKEN,
    DASHBOARD_ORIGIN: "https://shipaso.com",
    DB: fakeDb(activeEmails),
  } as unknown as Env;
}

function post(path: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-broadcast-token"] = token;
  return new Request(`https://api.shipaso.com${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
function get(path: string, token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["x-broadcast-token"] = token;
  return new Request(`https://api.shipaso.com${path}`, { headers });
}

// Fake ExecutionContext that AWAITS waitUntil work so the test can assert sends.
function ctx(): ExecutionContext {
  return { waitUntil: (p: Promise<unknown>) => { /* awaited via pending */ pending.push(p); }, passThroughOnException() {} } as unknown as ExecutionContext;
}
const pending: Promise<unknown>[] = [];

describe("/broadcast/* owner-gated", () => {
  beforeEach(() => { sent.length = 0; pending.length = 0; });

  it("403s without the owner token", async () => {
    const res = await handleApi(get("/broadcast/subscribers"), env());
    expect(res.status).toBe(403);
  });

  it("returns counts with the token", async () => {
    const res = await handleApi(get("/broadcast/subscribers", TOKEN), env(["a@x.com", "b@x.com"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: 2, unsubscribed: 0 });
  });

  it("test sends exactly one email to `to`", async () => {
    const res = await handleApi(post("/broadcast/test", { subject: "Hi", markdown: "# Hi", to: "me@x.com" }, TOKEN), env());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("me@x.com");
  });

  it("send requires confirm:true", async () => {
    const res = await handleApi(post("/broadcast/send", { subject: "Hi", markdown: "# Hi" }, TOKEN), env(["a@x.com"]));
    expect(res.status).toBe(400);
  });

  it("send queues to active subscribers, each with a List-Unsubscribe header", async () => {
    const c = ctx();
    const res = await handleApi(post("/broadcast/send", { subject: "Hi", markdown: "# Hi", confirm: true }, TOKEN), env(["a@x.com", "b@x.com"]), c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: 2 });
    await Promise.all(pending); // drain waitUntil
    expect(sent.map((s) => s.to).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(sent[0].headers?.["List-Unsubscribe"]).toMatch(/list\/unsubscribe\?token=/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `cd cloud && npx vitest run src/api/broadcast.spec.ts`
Expected: FAIL — routes 403/404 or missing.

- [ ] **Step 3: Add `BROADCAST_TOKEN` to `Env`.** In `cloud/src/index.ts` near line 103:

```ts
  RLHF_EXPORT_TOKEN?: string;
  BROADCAST_TOKEN?: string; // owner gate for /broadcast/* (degrade closed)
```

- [ ] **Step 4: Add the send engine.** In `cloud/src/broadcast.ts`, append:

```ts
import type { Env } from "./index.js";
import { emailSenderForEnv } from "./emailSender.js";
import { mintListUnsubToken } from "./auth.js";
// NOTE: do NOT import sessionSecret from ./api/index.js — api/index.ts imports
// this file, so that would be a circular import. Read env.SESSION_SECRET directly.

const CHUNK = 20;
const CHUNK_DELAY_MS = 1000;
const UNSUB_TTL = 60 * 60 * 24 * 90; // 90 days

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a rendered broadcast to a recipient list in rate-limited chunks. Each
 *  email carries a one-click List-Unsubscribe (header + footer link) with a
 *  signed list-unsub token. Per-email failures are caught + logged. */
export async function sendBroadcastToList(args: {
  env: Env;
  subject: string;
  markdown: string;
  recipients: { email: string }[];
  baseUrl: string;
}): Promise<{ sent: number; failed: number }> {
  const { env, subject, markdown, recipients, baseUrl } = args;
  const sender = emailSenderForEnv(env);
  const secret = env.SESSION_SECRET ?? "";
  let sentN = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const batch = recipients.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async ({ email }) => {
        try {
          const token = await mintListUnsubToken(secret, email, { ttlSeconds: UNSUB_TTL });
          const unsubUrl = `${baseUrl}/list/unsubscribe?token=${encodeURIComponent(token)}`;
          const { html, text } = renderBroadcast(subject, markdown);
          const footer = `<hr/><p style="color:#97a1b6;font-size:12px">You're getting this because you signed up for ShipASO updates. <a href="${unsubUrl}">Unsubscribe</a>.</p>`;
          const htmlWithFooter = html.replace("</body>", `${footer}</body>`);
          await sender.send({
            to: email,
            subject,
            html: htmlWithFooter,
            text: `${text}\n\nUnsubscribe: ${unsubUrl}`,
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          sentN++;
        } catch (e) {
          failed++;
          console.error(`[store-ops] broadcast send failed for ${email}: ${String(e)}`);
        }
      }),
    );
    if (i + CHUNK < recipients.length) await sleep(CHUNK_DELAY_MS);
  }
  console.log(`[store-ops] broadcast "${subject}": sent ${sentN}/${recipients.length} (failed ${failed})`);
  return { sent: sentN, failed };
}
```

Note: if `sessionSecret` is not exported from `api/index.ts`, use `env.SESSION_SECRET ?? ""` directly (as shown) — do NOT add an import that creates a cycle.

- [ ] **Step 5: Add the endpoints.** In `cloud/src/api/index.ts` (import `sendBroadcastToList`, `renderBroadcast`, `activeSubscribers`, `subscriberCounts`, `recordBroadcast`, `mintListUnsubToken`):

```ts
function requireBroadcastToken(req: Request, env: Env): boolean {
  const token = env.BROADCAST_TOKEN;
  return !!token && req.headers.get("x-broadcast-token") === token;
}

function broadcastBaseUrl(env: Env): string {
  return (env.DASHBOARD_ORIGIN ?? "https://shipaso.com").replace(/\/+$/, "");
}

async function broadcastSubscribersRoute(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  return json(await subscriberCounts(env.DB), 200, origin, env);
}

async function broadcastTestRoute(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  const body = await readJson<{ subject?: string; markdown?: string; to?: string }>(req);
  const subject = (body.subject ?? "").trim();
  const markdown = (body.markdown ?? "").trim();
  const to = (body.to ?? "").trim();
  if (!subject || !markdown || !looksLikeEmail(to)) throw new HttpError(400, "subject, markdown, and a valid `to` are required");
  await sendBroadcastToList({ env, subject, markdown, recipients: [{ email: to }], baseUrl: broadcastBaseUrl(env) });
  return json({ ok: true }, 200, origin, env);
}

async function broadcastSendRoute(req: Request, env: Env, origin: string | null, ctx?: ExecutionContext): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  const body = await readJson<{ subject?: string; markdown?: string; confirm?: boolean }>(req);
  const subject = (body.subject ?? "").trim();
  const markdown = (body.markdown ?? "").trim();
  if (!subject || !markdown) throw new HttpError(400, "subject and markdown are required");
  if (body.confirm !== true) throw new HttpError(400, "confirm must be true to send to the list");

  const recipients = await activeSubscribers(env.DB);
  await recordBroadcast(env.DB, { subject, recipientCount: recipients.length, sender: "owner" });

  const work = sendBroadcastToList({ env, subject, markdown, recipients, baseUrl: broadcastBaseUrl(env) });
  if (ctx) ctx.waitUntil(work);
  else await work; // no ctx (e.g. some test paths) → send inline
  return json({ ok: true, queued: recipients.length }, 200, origin, env);
}
```

- [ ] **Step 6: Wire the routes.** In `handleApi`'s routing block (these are owner-gated by header, so they can live near the public `preview`/`subscribe` block; the send route needs `ctx`):

```ts
    if (seg[0] === "broadcast" && seg[1] === "subscribers" && seg.length === 2 && method === "GET") {
      return broadcastSubscribersRoute(req, env, origin);
    }
    if (seg[0] === "broadcast" && seg[1] === "test" && seg.length === 2 && method === "POST") {
      return broadcastTestRoute(req, env, origin);
    }
    if (seg[0] === "broadcast" && seg[1] === "send" && seg.length === 2 && method === "POST") {
      return broadcastSendRoute(req, env, origin, ctx);
    }
```

- [ ] **Step 7: Run it, expect PASS.**

Run: `cd cloud && npx vitest run src/api/broadcast.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Full worker suite + typecheck (nothing regressed).**

Run: `cd cloud && npx tsc --noEmit && npx vitest run`
Expected: all pass.

- [ ] **Step 9: Commit.**

```bash
git add cloud/src/index.ts cloud/src/broadcast.ts cloud/src/api/index.ts cloud/src/api/broadcast.spec.ts
git commit -m "feat(api): owner-gated /broadcast/* with ctx.waitUntil chunked send

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `packages/api` client functions

Typed client fns for the web page. The owner token is passed per-call as a header.

**Files:**
- Modify: `packages/api/endpoints.ts`
- Modify: `packages/api/client.ts` (only if a per-call header pass-through doesn't exist — see Step 1)
- Test: none new (thin wrappers; exercised by the component test in Task 8)

**Interfaces:**
- Produces:
  - `broadcastCounts(c: ApiClient, token: string): Promise<{ active: number; unsubscribed: number }>`
  - `broadcastTest(c: ApiClient, token: string, body: { subject: string; markdown: string; to: string }): Promise<{ ok: true }>`
  - `broadcastSend(c: ApiClient, token: string, body: { subject: string; markdown: string; confirm: true }): Promise<{ ok: true; queued: number }>`

- [ ] **Step 1: Check how the client sends custom headers.** Read `packages/api/client.ts`. The `post`/`get` methods build headers from `authHeaders()`. If they already accept a per-call header arg, use it. If NOT, add an optional last param:

```ts
// in ApiClient type:
get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T>;
post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T>;
```

and merge `extraHeaders` into the `headers` object in `request(...)` (spread after the existing headers so callers can add `x-broadcast-token`). Keep it minimal and additive.

- [ ] **Step 2: Add the endpoint fns.** In `packages/api/endpoints.ts`, after `subscribe`:

```ts
/** Owner-gated broadcast tool. `token` is the BROADCAST_TOKEN, sent per-call. */
export const broadcastCounts = (c: ApiClient, token: string) =>
  c.get<{ active: number; unsubscribed: number }>("/broadcast/subscribers", { "x-broadcast-token": token });
export const broadcastTest = (
  c: ApiClient,
  token: string,
  body: { subject: string; markdown: string; to: string },
) => c.post<{ ok: true }>("/broadcast/test", body, { "x-broadcast-token": token });
export const broadcastSend = (
  c: ApiClient,
  token: string,
  body: { subject: string; markdown: string; confirm: true },
) => c.post<{ ok: true; queued: number }>("/broadcast/send", body, { "x-broadcast-token": token });
```

- [ ] **Step 3: Typecheck the package.**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add packages/api/endpoints.ts packages/api/client.ts
git commit -m "feat(api-client): broadcast counts/test/send with per-call owner token

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `BroadcastView` page + routing

Owner-only compose/preview/send page at `/broadcast`, wired into the router + edge map. Reuses `renderBroadcast` for the preview so preview == sent.

**Files:**
- Create: `cloud/web/src/features/broadcast/BroadcastView.tsx`
- Create: `cloud/web/src/features/broadcast/BroadcastView.test.tsx`
- Create: `cloud/web/src/lib/renderBroadcast.ts` (copy of the pure renderer for the web preview — see note)
- Modify: `cloud/web/src/routes/public.tsx` (add `BroadcastRoute`) — OR a new route file
- Modify: `cloud/web/src/router.tsx`
- Modify: `cloud/web/src/shell/edgeRoutes.ts` + `edgeRoutes.test.ts`

**Interfaces:**
- Consumes: `broadcastCounts`, `broadcastTest`, `broadcastSend` (Task 7); a client instance.
- Produces: `BroadcastView({ client }: { client: ApiClient })`; `BroadcastRoute` wired at `/broadcast`.

Note on the renderer: the worker's `renderBroadcast` lives in `cloud/src` (not importable by the web app). Copy the SAME pure function into `cloud/web/src/lib/renderBroadcast.ts` (identical logic) so the preview matches. Keep a comment in both pointing at the other. (Small deliberate duplication — a shared package for one function is over-engineering here.)

- [ ] **Step 1: Write the failing component test.** Create `cloud/web/src/features/broadcast/BroadcastView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { BroadcastView } from "./BroadcastView.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function client(over: Partial<ApiClient> = {}): ApiClient {
  return { get: vi.fn(async () => ({ active: 5, unsubscribed: 1 })), post: vi.fn(async () => ({ ok: true })), request: vi.fn(), ...over } as unknown as ApiClient;
}

describe("<BroadcastView />", () => {
  it("gates on the owner token: counts load only after a token is entered", async () => {
    const get = vi.fn(async () => ({ active: 5, unsubscribed: 1 }));
    wrap(<BroadcastView client={client({ get })} />);
    fireEvent.change(screen.getByTestId("bc-token"), { target: { value: "tok" } });
    fireEvent.click(screen.getByTestId("bc-load"));
    await waitFor(() => expect(screen.getByTestId("bc-count")).toHaveTextContent("5"));
    expect(get).toHaveBeenCalledWith("/broadcast/subscribers", { "x-broadcast-token": "tok" });
  });

  it("shows a live preview of the markdown", () => {
    wrap(<BroadcastView client={client()} />);
    fireEvent.change(screen.getByTestId("bc-markdown"), { target: { value: "# Hello" } });
    expect(screen.getByTestId("bc-preview").innerHTML).toContain("<h1>Hello</h1>");
  });

  it("disables the real send until the confirm box is checked", () => {
    wrap(<BroadcastView client={client()} />);
    fireEvent.change(screen.getByTestId("bc-token"), { target: { value: "tok" } });
    fireEvent.change(screen.getByTestId("bc-subject"), { target: { value: "Launch" } });
    fireEvent.change(screen.getByTestId("bc-markdown"), { target: { value: "# Hi" } });
    expect(screen.getByTestId("bc-send")).toBeDisabled();
    fireEvent.click(screen.getByTestId("bc-confirm"));
    expect(screen.getByTestId("bc-send")).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `cd cloud/web && npx vitest run src/features/broadcast/BroadcastView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the web renderer.** Create `cloud/web/src/lib/renderBroadcast.ts` — copy the EXACT body of `renderBroadcast` from `cloud/src/broadcast.ts` (the function + `escapeHtml` + `inline` helpers), with a header comment: `// Mirror of cloud/src/broadcast.ts renderBroadcast — keep in sync (used for the compose preview).`

- [ ] **Step 4: Create the component.** Create `cloud/web/src/features/broadcast/BroadcastView.tsx`:

```tsx
/**
 * Owner-only broadcast composer at /broadcast. Token-gated (paste BROADCAST_TOKEN,
 * held in component state only — never persisted). Compose markdown with a live
 * preview (same renderer the email uses), send a test to yourself, then a
 * confirmed send to the whole active list. The browser only ever sees counts.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { broadcastCounts, broadcastTest, broadcastSend } from "@shipaso/api";
import { renderBroadcast } from "../../lib/renderBroadcast.js";

export function BroadcastView({ client }: { client: ApiClient }) {
  const [token, setToken] = useState("");
  const [subject, setSubject] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [testTo, setTestTo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: () => broadcastCounts(client, token),
    onSuccess: (r) => { setCount(r.active); setNote(null); },
    onError: () => setNote("Not authorized (check the token)."),
  });
  const test = useMutation({
    mutationFn: () => broadcastTest(client, token, { subject: subject.trim(), markdown: markdown.trim(), to: testTo.trim() }),
    onSuccess: () => setNote("Test sent — check your inbox."),
    onError: () => setNote("Test failed (token or fields)."),
  });
  const send = useMutation({
    mutationFn: () => broadcastSend(client, token, { subject: subject.trim(), markdown: markdown.trim(), confirm: true }),
    onSuccess: (r) => setNote(`Queued to ${r.queued} subscribers.`),
    onError: () => setNote("Send failed."),
  });

  const preview = renderBroadcast(subject || " ", markdown);
  const canCompose = !!token && !!subject.trim() && !!markdown.trim();

  return (
    <section>
      <h1>Broadcast</h1>
      <p className="muted">Send a launch/newsletter update to the subscriber list. Owner-only.</p>

      <div className="card">
        <b>Owner token</b>
        <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
          <input className="txt" data-testid="bc-token" type="password" value={token} placeholder="BROADCAST_TOKEN" onChange={(e) => setToken(e.target.value)} />
          <button type="button" className="btn" data-testid="bc-load" disabled={!token || load.isPending} onClick={() => load.mutate()}>
            {load.isPending ? "Loading…" : "Load list"}
          </button>
        </div>
        {count != null ? <p className="muted" data-testid="bc-count" style={{ marginTop: 8 }}>{count} active subscribers</p> : null}
      </div>

      <div className="card">
        <b>Compose</b>
        <input className="txt" data-testid="bc-subject" value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 8, width: "100%" }} />
        <textarea className="txt" data-testid="bc-markdown" value={markdown} placeholder="# Heading&#10;&#10;Body in **markdown**…" onChange={(e) => setMarkdown(e.target.value)} rows={8} style={{ marginTop: 8, width: "100%" }} />
        <b style={{ display: "block", marginTop: 12 }}>Preview</b>
        <div className="card" data-testid="bc-preview" style={{ background: "var(--bg-2)" }} dangerouslySetInnerHTML={{ __html: preview.html }} />
      </div>

      <div className="card">
        <b>Send a test to yourself first</b>
        <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
          <input className="txt" data-testid="bc-testto" type="email" value={testTo} placeholder="you@example.com" onChange={(e) => setTestTo(e.target.value)} />
          <button type="button" className="btn" data-testid="bc-test" disabled={!canCompose || !/\S+@\S+\.\S+/.test(testTo) || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>

      <div className="card">
        <b>Send to the whole list</b>
        <label style={{ display: "block", margin: "8px 0" }}>
          <input type="checkbox" data-testid="bc-confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I've previewed a test and want to send to all active subscribers.
        </label>
        <button type="button" className="btn primary bad" data-testid="bc-send" disabled={!canCompose || !confirmed || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? "Queuing…" : `Send to ${count ?? "the"} subscribers`}
        </button>
      </div>

      {note ? <p className="muted" data-testid="bc-note" style={{ marginTop: 12 }}>{note}</p> : null}
    </section>
  );
}
```

- [ ] **Step 5: Run the component test, expect PASS.**

Run: `cd cloud/web && npx vitest run src/features/broadcast/BroadcastView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire the route.** In `cloud/web/src/routes/public.tsx` add:

```tsx
import { BroadcastView } from "../features/broadcast/BroadcastView.js";

export function BroadcastRoute() {
  return <BroadcastView client={client} />;
}
```

In `cloud/web/src/router.tsx`: import `BroadcastRoute` from `./routes/public.js`, add
```tsx
const broadcastRoute = createRoute({ getParentRoute: () => rootRoute, path: "/broadcast", component: BroadcastRoute });
```
and add `broadcastRoute` to `addChildren([...])`.

In `cloud/web/src/shell/edgeRoutes.ts`: add `"/broadcast",` to `OWNED_PATHS`.

- [ ] **Step 7: Add the edge-map test case.** In `cloud/web/src/shell/edgeRoutes.test.ts`, inside the top describe:

```ts
  it("owns /broadcast (owner-only composer)", () => {
    expect(resolveSurface("/broadcast", OWNED_PATHS)).toBe("web");
  });
```

- [ ] **Step 8: Build + full web suite.**

Run: `cd cloud/web && npm run build && npx vitest run`
Expected: build clean; all tests pass.

- [ ] **Step 9: Commit.**

```bash
git add cloud/web/src/features/broadcast cloud/web/src/lib/renderBroadcast.ts cloud/web/src/routes/public.tsx cloud/web/src/router.tsx cloud/web/src/shell/edgeRoutes.ts cloud/web/src/shell/edgeRoutes.test.ts
git commit -m "feat(web): owner-only /broadcast composer page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Full gate — typecheck, tests, React Doctor, schema note

Verify everything and document the operational setup (the `wrangler` migration + the `BROADCAST_TOKEN` secret).

**Files:**
- Modify: `cloud/README.md` or `mobile/STORE.md`-style note — add the migration + secret to the deploy notes (a `docs` line).

- [ ] **Step 1: Worker: typecheck + full suite.**

Run: `cd cloud && npx tsc --noEmit && npx vitest run`
Expected: all pass.

- [ ] **Step 2: Web: build + full suite + React Doctor.**

Run: `cd cloud/web && npm run build && npx vitest run && npx react-doctor@latest --scope changed`
Expected: build clean, tests pass, React Doctor does not regress.

- [ ] **Step 3: Document the operational steps.** Append to `cloud/README.md` (near the secrets section):

```markdown
## Broadcast tool (launch list)

One-time D1 migration (existing db):
​```bash
npx wrangler d1 execute store_ops --remote --command "ALTER TABLE subscribers ADD COLUMN unsubscribed_at TEXT"
npx wrangler d1 execute store_ops --remote --command "CREATE TABLE IF NOT EXISTS broadcasts (id TEXT PRIMARY KEY, subject TEXT NOT NULL, recipient_count INTEGER NOT NULL, sender TEXT, sent_at TEXT NOT NULL DEFAULT (datetime('now')))"
​```

Set the owner token (already done if `wrangler secret list` shows it):
​```bash
openssl rand -base64 32 | npx wrangler secret put BROADCAST_TOKEN
​```

Then visit `/broadcast`, paste the token, compose, send a test to yourself, and
send to the list. Sending happens in the background (ctx.waitUntil) in chunks of
20; very large lists may exceed the Worker background budget — a future Cloudflare
Queue is the upgrade path (see the design spec).
```

- [ ] **Step 4: Commit.**

```bash
git add cloud/README.md
git commit -m "docs(broadcast): D1 migration + BROADCAST_TOKEN setup notes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- Run worker commands from `cloud/`, web commands from `cloud/web/`, package commands from `packages/api/`.
- Do NOT open a PR or merge — stop after Task 9 and report.
- The `BROADCAST_TOKEN` secret is already set on the `store-ops` Worker; the D1 migration (Task 9) must be run by the user against `--remote` before the live feature works (the code degrades gracefully: no token → 403; missing column → the migration note covers it).
- Keep `cloud/src/broadcast.ts`'s `renderBroadcast` and `cloud/web/src/lib/renderBroadcast.ts` byte-identical in logic.
