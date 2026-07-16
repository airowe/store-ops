/**
 * POST /preview — an upstream App Store (iTunes) failure must surface as an
 * HONEST error, not a bare 500 "internal error".
 *
 * Regression: on the acquisition landing page, auditing a listing while the
 * iTunes lookup/search was rate-limited or slow threw an uncaught `ItunesError`
 * (fetchJson exhausts its retries → throws), which the router's public-route
 * catch turned into a generic `500 {"error":"internal error"}`. A cold visitor
 * saw "internal error" — the exact scary/opaque message the funnel is supposed
 * never to show. This asserts the response is NOT a 500 and carries a
 * human-readable message.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function post(path: string, body: unknown): Request {
  return new Request(`https://api.shipaso.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Minimal env: no TINYFISH_API_KEY, so fetchForEnv falls back to the global
// fetch we stub below. No AI reasoner, no DB access on the /preview path before
// the iTunes call that we make fail.
const ENV = { DEFAULT_COUNTRY: "US" } as unknown as Env;

describe("POST /preview — upstream App Store failure is honest, not a 500", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Every iTunes call returns 429 (rate-limited). fetchJson retries with
    // backoff and ultimately throws ItunesError("HTTP 429").
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("does NOT return a 500 'internal error' when iTunes is rate-limited", async () => {
    const res = await handleApi(post("/preview", { query: "com.shipaso.app" }), ENV);
    const bodyText = await res.text();

    // The core assertion: the bug produced 500 {"error":"internal error"}.
    expect(res.status).not.toBe(500);
    expect(bodyText).not.toContain("internal error");

    // And it should be an honest upstream-failure status with a human message.
    expect([502, 503]).toContain(res.status);
    const body = JSON.parse(bodyText) as { error?: string };
    expect(body.error ?? "").toMatch(/app store|try again|temporarily|couldn.t reach/i);
  });
});
