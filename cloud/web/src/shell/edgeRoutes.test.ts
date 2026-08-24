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
  it("owns /privacy (the App Store privacy-policy URL target)", () => {
    // /privacy is served by the redesign; without it here the edge proxies to
    // legacy and the App Store Privacy Policy URL renders the wrong page.
    expect(resolveSurface("/privacy", OWNED_PATHS)).toBe("web");
  });
  it("still proxies genuinely unknown/deep paths to legacy", () => {
    for (const p of ["/apps/abc/extra/deep", "/some-legacy-thing"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
  });

  it("owns /runs/:id (the money screen) — PRD 07 cutover", () => {
    // A real run id: `uuid()` (cloud/src/d1.ts). Since #359 the pattern is
    // UUID-shaped, so "xyz" is no longer a stand-in for one.
    const id = "3f8a1c2e-4b5d-6789-abcd-ef0123456789";
    expect(resolveSurface(`/runs/${id}`, OWNED_PATHS)).toBe("web");
    expect(resolveSurface(`/runs/${id}/extra`, OWNED_PATHS)).toBe("legacy");
  });

  it("owns the three portfolio index screens (#356)", () => {
    for (const p of ["/runs", "/keywords", "/competitors"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("web");
    }
  });

  /**
   * The string arm of resolveSurface is a PREFIX match, so listing these as
   * plain strings would hand every nested API path to the SPA — /runs/:id/asc/
   * push, /runs/approve-all and the rest would render HTML instead of calling
   * the Worker. They are RegExps for exactly this reason; this pins it.
   */
  it("the index paths never swallow their nested API routes", () => {
    for (const p of ["/runs/xyz/asc/push", "/keywords/anything", "/competitors/x"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
  });

  /**
   * #359: `/runs/:id` matched ANY single segment, and `approve-all` is shaped
   * exactly like a run id — so the SPA claimed a Worker API path. Latent (it is
   * a POST to the API origin, and resolveSurface only routes navigations), but
   * any future GET-able sibling would inherit it silently, and the failure mode
   * is HTML served where JSON was expected.
   *
   * Run ids are UUIDs (`uuid()` in d1.ts), so the pattern says so.
   */
  it("does not claim /runs/approve-all — it is an API path, not a run id", () => {
    expect(resolveSurface("/runs/approve-all", OWNED_PATHS)).toBe("legacy");
  });

  it("still owns a real run id, which is a UUID", () => {
    expect(resolveSurface("/runs/3f8a1c2e-4b5d-6789-abcd-ef0123456789", OWNED_PATHS)).toBe("web");
    // …and rejects other non-id single segments that could appear later.
    for (const p of ["/runs/export", "/runs/search"]) {
      expect(resolveSurface(p, OWNED_PATHS)).toBe("legacy");
    }
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

  // Temporarily un-owned while the guided setup is completed (#504 cutover).
  // The flow is reachable by URL, so a partial wizard would be visible to
  // anyone who guesses the path — including an App Review reviewer. Restored
  // in the final task of docs/superpowers/plans/2026-08-24-onboarding-cutover.md
  it("does not own /onboarding while the flow is incomplete", () => {
    expect(resolveSurface("/onboarding", OWNED_PATHS)).toBe("legacy");
  });
});
