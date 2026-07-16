import { describe, it, expect, vi, beforeEach } from "vitest";
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
    expect(sent[0]?.to).toBe("me@x.com");
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
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toMatch(/list\/unsubscribe\?token=/);
  });
});
