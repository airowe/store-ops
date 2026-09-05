import { describe, expect, it } from "vitest";
import { spaBypass } from "./devProxyBypass";

/**
 * #482 — the dev proxy swallowed `/apps/:id`. A browser navigation must get
 * the SPA shell; the spine's API fetches must still reach the Worker.
 */
const req = (accept?: string | string[]) => ({ headers: { accept } });

describe("spaBypass (#482)", () => {
  it("hands a browser navigation to the SPA shell", () => {
    expect(spaBypass(req("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"))).toBe("/index.html");
    expect(spaBypass(req("TEXT/HTML"))).toBe("/index.html");
  });

  it("still proxies the spine's fetches", () => {
    expect(spaBypass(req("application/json"))).toBeUndefined();
    expect(spaBypass(req("application/json, text/plain, */*"))).toBeUndefined();
  });

  it("still proxies a bare client with no or wildcard Accept — the issue's curl repro is an API call", () => {
    expect(spaBypass(req(undefined))).toBeUndefined();
    expect(spaBypass(req("*/*"))).toBeUndefined();
  });

  it("tolerates a multi-valued header", () => {
    expect(spaBypass(req(["application/json", "text/html"]))).toBe("/index.html");
  });
});
