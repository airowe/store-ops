import { describe, it, expect } from "vitest";
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
