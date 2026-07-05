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
  it("/settings is now owned by the new app (PRD 03 cutover)", () => {
    expect(resolveSurface("/settings", OWNED_PATHS)).toBe("web");
  });
  it("still proxies un-migrated routes to legacy", () => {
    for (const p of ["/", "/apps/abc", "/runs/xyz"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
  });
  it("a prefix must match a full segment (no accidental /settings-foo capture)", () => {
    expect(resolveSurface("/settingsX", ["/settings"])).toBe("legacy");
    expect(resolveSurface("/settings", ["/settings"])).toBe("web");
  });
});
