/**
 * POST /lint/review-risk (#178 Phase 1) — the route glue: input validation, auth,
 * delegation to the pure engine. The engine's checks (2.3.1 / 2.3.7 / price /
 * placeholder) are covered in engine/reviewRiskLint.spec.ts; here we drive the
 * real `handleApi`.
 */
import { describe, expect, it } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function fakeUsersDb(): D1Database {
  const users = new Map<string, { id: string; email: string }>();
  function prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { bound = a; return stmt; },
      async first<T>() {
        if (/FROM users WHERE email = \?/.test(s)) return (users.get(String(bound[0])) ?? null) as T | null;
        if (/FROM users WHERE id = \?/.test(s)) return ([...users.values()].find((u) => u.id === bound[0]) ?? null) as T | null;
        return null as T | null;
      },
      async run() {
        if (/^INSERT INTO users/.test(s)) users.set(String(bound[1]), { id: String(bound[0]), email: String(bound[1]) });
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() { return { results: [] as T[] }; },
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function makeEnv(): Env {
  return { DB: fakeUsersDb(), DEFAULT_COUNTRY: "US", APP_ENV: "demo", AI: {} as unknown } as Env;
}

const CLEAN = { name: "Mangia", subtitle: "Plan meals and groceries", keywords: "recipe,pantry,grocery" };

function req(body: unknown, email = "owner@example.com"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (email) headers["x-user-email"] = email;
  return new Request("https://api.test/lint/review-risk", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /lint/review-risk", () => {
  it("returns no findings for clean copy", async () => {
    const res = await handleApi(req({ copy: CLEAN }), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { findings: unknown[] };
    expect(body.findings).toEqual([]);
  });

  it("flags a cited risk and returns the guideline + verbatim quote", async () => {
    const res = await handleApi(req({ copy: { ...CLEAN, name: "#1 Best Recipe App" } }), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { findings: Array<{ guideline: string; quote: string; disclaimer: string }> };
    expect(body.findings.length).toBeGreaterThan(0);
    expect(body.findings[0]!.guideline).toBe("2.3.1");
    expect(body.findings[0]!.quote.length).toBeGreaterThan(0);
    expect(body.findings[0]!.disclaimer).toMatch(/not Apple's verdict/i);
  });

  it("honors a competitorBrands list in the keyword field (2.3.7)", async () => {
    const res = await handleApi(
      req({ copy: { ...CLEAN, keywords: "recipe,acmeapp" }, competitorBrands: ["acmeapp"] }),
      makeEnv(),
    );
    const body = (await res.json()) as { findings: Array<{ guideline: string }> };
    expect(body.findings.some((f) => f.guideline === "2.3.7")).toBe(true);
  });

  it("400 on a malformed copy object", async () => {
    expect((await handleApi(req({ copy: { name: "x" } }), makeEnv())).status).toBe(400);
  });

  it("401 without a user", async () => {
    expect((await handleApi(req({ copy: CLEAN }, ""), makeEnv())).status).toBe(401);
  });
});
