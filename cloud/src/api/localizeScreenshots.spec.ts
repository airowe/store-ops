/**
 * POST /localize/screenshots (#78 item 3, v1-A) — the route glue: input
 * validation, the AI-binding gate, and delegation to the engine. The engine's
 * own logic (fit, RTL exclusion, brand preservation) is covered in
 * engine/localizeScreenshots.spec.ts; here we drive the real `handleApi`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// A localizer that echoes locale; null when the deployment has no AI binding.
let localizerAvailable = true;
vi.mock("./aiLocalizer.js", () => ({
  localizerForEnv: () =>
    localizerAvailable
      ? async ({ text, targetLocale }: { text: string; targetLocale: string }) => `${text} (${targetLocale})`
      : null,
}));

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

const SOURCE = { slots: [{ id: "headline", text: "Plan meals fast", fontSize: 40, box: { width: 300, height: 120 } }] };
function req(body: unknown, email = "owner@example.com"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (email) headers["x-user-email"] = email;
  return new Request("https://api.test/localize/screenshots", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  localizerAvailable = true;
});

describe("POST /localize/screenshots", () => {
  it("localizes captions per locale, excludes RTL", async () => {
    const res = await handleApi(req({ source: SOURCE, targetLocales: ["de-DE", "ar"], brandTokens: [] }), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      localized: Array<{ locale: string; slots: Array<{ text: string }> }>;
      excluded: Array<{ locale: string }>;
    };
    expect(body.localized.map((l) => l.locale)).toEqual(["de-DE"]);
    expect(body.localized[0]!.slots[0]!.text).toContain("(de-DE)");
    expect(body.excluded.map((e) => e.locale)).toEqual(["ar"]);
  });

  it("400 on an empty/invalid source", async () => {
    expect((await handleApi(req({ source: { slots: [] }, targetLocales: ["de-DE"] }), makeEnv())).status).toBe(400);
    expect((await handleApi(req({ source: { slots: [{ id: "x" }] }, targetLocales: ["de-DE"] }), makeEnv())).status).toBe(400);
  });

  it("400 when targetLocales is empty", async () => {
    expect((await handleApi(req({ source: SOURCE, targetLocales: [] }), makeEnv())).status).toBe(400);
  });

  it("503 when the deployment has no AI binding", async () => {
    localizerAvailable = false;
    expect((await handleApi(req({ source: SOURCE, targetLocales: ["de-DE"] }), makeEnv())).status).toBe(503);
  });

  it("401 without a user", async () => {
    expect((await handleApi(req({ source: SOURCE, targetLocales: ["de-DE"] }, ""), makeEnv())).status).toBe(401);
  });
});
