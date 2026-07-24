import { describe, it, expect } from "vitest";
import { pageTitle, railHeading, SITE } from "./pageTitle.js";

describe("pageTitle (per-route document.title)", () => {
  it("gives the public landing page a marketing title — NOT 'dashboard'", () => {
    // The root is the cold-traffic acquisition front door; its tab / SEO / share
    // title must not say 'dashboard' to someone who has never signed in.
    const t = pageTitle("/");
    expect(t).toBe(SITE);
    expect(t.toLowerCase()).not.toContain("dashboard");
  });

  it("titles the dashboard 'dashboard'", () => {
    expect(pageTitle("/dashboard")).toBe(`${SITE} · dashboard`);
  });

  it.each([
    ["/login", `${SITE} · sign in`],
    ["/preview", `${SITE} · free audit`],
    ["/proof", `${SITE} · proof`],
    ["/privacy", `${SITE} · privacy`],
    ["/settings", `${SITE} · settings`],
  ])("titles the known route %s as %s", (path, expected) => {
    expect(pageTitle(path)).toBe(expected);
  });

  it("titles dynamic app/run routes generically (no id leaked into the title)", () => {
    expect(pageTitle("/apps/6787632160")).toBe(`${SITE} · app`);
    expect(pageTitle("/apps/6787632160/war-room")).toBe(`${SITE} · war room`);
    expect(pageTitle("/runs/run_abc")).toBe(`${SITE} · run`);
  });

  it("falls back to the bare site name for an unknown path (never a stale label)", () => {
    expect(pageTitle("/something-unmapped")).toBe(SITE);
  });

  it("normalizes a trailing slash", () => {
    expect(pageTitle("/dashboard/")).toBe(`${SITE} · dashboard`);
  });
});

describe("railHeading (in-app topbar heading)", () => {
  it.each([
    ["/dashboard", "Overview"],
    ["/settings", "Settings"],
    ["/apps/6787632160", "App"],
    ["/apps/6787632160/war-room", "War room"],
    ["/runs/run_abc", "Run"],
  ])("headings %s as %s", (path, expected) => {
    expect(railHeading(path)).toBe(expected);
  });

  it("is distinct from the tab title — a short human word, not the site-prefixed form", () => {
    expect(railHeading("/dashboard")).toBe("Overview");
    expect(railHeading("/dashboard")).not.toContain(SITE);
  });

  it("normalizes a trailing slash", () => {
    expect(railHeading("/settings/")).toBe("Settings");
  });
});
