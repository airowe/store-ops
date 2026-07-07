import { describe, expect, it } from "vitest";
import { detectPortfolio } from "./portfolio.js";
import type { StorefrontApp } from "./storefrontListing.js";

/**
 * Storefront-intel PRD 05 — portfolio auto-detection from the storefront's
 * moreByDeveloper shelf. Suggests only; never auto-tracks. Shelf absent is
 * UNKNOWN (known:false), never zero.
 */

const a = (bundleId: string, name: string, extra: Partial<StorefrontApp> = {}): StorefrontApp => ({
  bundleId,
  name,
  ...extra,
});

describe("detectPortfolio (pure)", () => {
  it("drops the audited app itself and apps already tracked (case-insensitive)", () => {
    const shelf = [
      a("com.self.app", "Self"),
      a("com.acme.one", "One"),
      a("COM.ACME.TWO", "Two"), // tracked under different case → dropped
      a("com.acme.three", "Three"),
    ];
    const r = detectPortfolio(shelf, ["com.acme.two"], "com.self.app");
    expect(r).toEqual({
      known: true,
      suggestions: [a("com.acme.one", "One"), a("com.acme.three", "Three")],
    });
  });

  it("preserves optional fields verbatim and shelf order", () => {
    const shelf = [
      a("com.acme.b", "B"),
      a("com.acme.a", "A", { subtitle: "Do A", rating: 4.5, ratingCount: 10 }),
    ];
    const r = detectPortfolio(shelf, [], "com.self.app");
    expect(r).toEqual({
      known: true,
      suggestions: [
        a("com.acme.b", "B"),
        a("com.acme.a", "A", { subtitle: "Do A", rating: 4.5, ratingCount: 10 }),
      ],
    });
  });

  it("undefined shelf → known:false (unknown, never an empty list)", () => {
    expect(detectPortfolio(undefined, ["com.acme.one"], "com.self.app")).toEqual({ known: false });
  });

  it("shelf read but everything already tracked (or self) → known:true with []", () => {
    const shelf = [a("com.self.app", "Self"), a("com.acme.one", "One")];
    expect(detectPortfolio(shelf, ["com.acme.one"], "com.self.app")).toEqual({
      known: true,
      suggestions: [],
    });
  });

  it("an empty shelf array is a read that found nothing new → known:true, []", () => {
    expect(detectPortfolio([], [], "com.self.app")).toEqual({ known: true, suggestions: [] });
  });

  it("is deterministic — same input twice → deep-equal", () => {
    const shelf = [a("com.acme.a", "A"), a("com.acme.b", "B")];
    expect(detectPortfolio(shelf, [], "self")).toEqual(detectPortfolio(shelf, [], "self"));
  });
});

describe("detectPortfolio — trace JSON round-trip (survives persistence)", () => {
  it("reads moreByDeveloper back out of a serialized-then-parsed trace shape", () => {
    // The API path reads trace.audit.storefront.moreByDeveloper from
    // runs.reasoning_json (JSON.parse). Prove the field survives that round-trip.
    const trace = {
      audit: {
        app: "self",
        bundleId: "com.self.app",
        screenshots: null,
        liveName: "Self",
        storefront: {
          moreByDeveloper: [
            a("com.acme.one", "One", { subtitle: "Do one" }),
            a("com.acme.two", "Two"),
          ],
        },
      },
    };
    const parsed = JSON.parse(JSON.stringify(trace)) as typeof trace;
    const r = detectPortfolio(
      parsed.audit.storefront?.moreByDeveloper,
      ["com.acme.two"],
      "com.self.app",
    );
    expect(r).toEqual({ known: true, suggestions: [a("com.acme.one", "One", { subtitle: "Do one" })] });
  });

  it("a pre-seam trace (no storefront) yields known:false", () => {
    const trace = { audit: { app: "s", bundleId: "com.self.app", screenshots: null, liveName: "S" } };
    const parsed = JSON.parse(JSON.stringify(trace)) as { audit: { storefront?: { moreByDeveloper?: StorefrontApp[] } } };
    expect(detectPortfolio(parsed.audit.storefront?.moreByDeveloper, [], "com.self.app")).toEqual({
      known: false,
    });
  });
});
