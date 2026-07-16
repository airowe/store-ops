/**
 * CORS preflight — the custom auth headers the web app sends cross-origin MUST
 * be in access-control-allow-headers, or the browser blocks the real request
 * before it ever reaches the handler.
 *
 * Regression: the /broadcast page (app.shipaso.com) calls the API
 * (api.shipaso.com) with `x-broadcast-token`. That header was missing from the
 * allowlist, so the browser's OPTIONS preflight didn't permit it and every
 * "Load list" failed with "Not authorized" — even though the token was correct
 * (curl, which skips preflight, worked). This pins the allowlist.
 */
import { describe, it, expect } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function options(path: string): Request {
  return new Request(`https://api.shipaso.com${path}`, {
    method: "OPTIONS",
    headers: {
      origin: "https://app.shipaso.com",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-broadcast-token",
    },
  });
}

const ENV = { DASHBOARD_ORIGIN: "https://app.shipaso.com" } as unknown as Env;

describe("CORS preflight allow-headers", () => {
  it("permits x-broadcast-token (the owner-only broadcast gate header)", async () => {
    const res = await handleApi(options("/broadcast/subscribers"), ENV);
    expect(res.status).toBe(204);
    const allow = res.headers.get("access-control-allow-headers") ?? "";
    expect(allow.toLowerCase()).toContain("x-broadcast-token");
  });

  it("still permits the pre-existing custom headers", async () => {
    const res = await handleApi(options("/apps"), ENV);
    const allow = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allow).toContain("content-type");
    expect(allow).toContain("x-user-email");
    expect(allow).toContain("stripe-signature");
  });
});
