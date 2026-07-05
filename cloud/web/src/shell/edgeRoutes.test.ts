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
  it("proxies un-migrated routes to legacy (default: nothing user-facing is owned)", () => {
    for (const p of ["/", "/apps/abc", "/runs/xyz", "/settings"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
  });
  it("a prefix must match a full segment (no accidental /settings-foo capture)", () => {
    expect(resolveSurface("/settingsX", ["/settings"])).toBe("legacy");
    expect(resolveSurface("/settings", ["/settings"])).toBe("web");
  });
});
