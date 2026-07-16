import { describe, it, expect } from "vitest";
import { resolveSurface, OWNED_PATHS } from "./edgeRoutes.js";

describe("resolveSurface (strangler edge map)", () => {
  it("routes an owned path to the new web app", () => {
    expect(resolveSurface("/_shell/health")).toBe("web");
  });
  it("routes an owned path's children to web", () => {
    expect(resolveSurface("/_shell/health/deep", ["/_shell/health"])).toBe("web");
  });
  it("normalizes a trailing slash", () => {
    expect(resolveSurface("/_shell/health/", ["/_shell/health"])).toBe("web");
  });
  it("owns the migrated routes (/, /settings) — PRD 03/04 cutovers", () => {
    expect(resolveSurface("/settings", OWNED_PATHS)).toBe("web");
    expect(resolveSurface("/", OWNED_PATHS)).toBe("web");
  });
  it("owns the public surfaces (PRD 09): /login, /preview, /proof", () => {
    for (const p of ["/login", "/preview", "/proof"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("web");
    }
  });
  it("still proxies genuinely unknown/deep paths to legacy", () => {
    for (const p of ["/apps/abc/extra/deep", "/some-legacy-thing"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
  });

  it("owns /runs/:id (the money screen) — PRD 07 cutover", () => {
    expect(resolveSurface("/runs/xyz", OWNED_PATHS)).toBe("web");
    expect(resolveSurface("/runs/xyz/extra", OWNED_PATHS)).toBe("legacy");
  });
  it("owning '/' does not accidentally own deep paths", () => {
    // "/" matches only the exact root, never /apps/* etc.
    expect(resolveSurface("/apps/abc", ["/"])).toBe("legacy");
    expect(resolveSurface("/", ["/"])).toBe("web");
  });

  it("owns /apps/:id and /apps/:id/war-room, but not the bare /apps", () => {
    expect(resolveSurface("/apps/abc", OWNED_PATHS)).toBe("web"); // PRD 05
    expect(resolveSurface("/apps/abc/war-room", OWNED_PATHS)).toBe("web"); // PRD 06
    expect(resolveSurface("/apps", OWNED_PATHS)).toBe("legacy"); // connect endpoint, not a page
  });
  it("a prefix must match a full segment (no accidental /settings-foo capture)", () => {
    expect(resolveSurface("/settingsX", ["/settings"])).toBe("legacy");
    expect(resolveSurface("/settings", ["/settings"])).toBe("web");
  });

  it("owns /dashboard (the authed dashboard's new home)", () => {
    expect(resolveSurface("/dashboard", OWNED_PATHS)).toBe("web");
  });

  it("owns /broadcast (owner-only composer)", () => {
    expect(resolveSurface("/broadcast", OWNED_PATHS)).toBe("web");
  });
});
