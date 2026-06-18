import { describe, expect, it } from "vitest";
import { buildAscContext, FORBIDDEN_CONTEXT_KEYS } from "./ascContext.js";
import type { AscSnapshot } from "./ascRead.js";

/**
 * `buildAscContext` is the privacy boundary in code form: it distils the bulky,
 * partly-sensitive `AscSnapshot` (pricing numbers, every locale's full copy,
 * privacy-policy text, asset URLs) down to the handful of NON-sensitive display
 * scalars the run-page card references. These tests pin BOTH that the right
 * values survive AND that nothing forbidden leaks.
 */

/** A representative snapshot with sensitive fields populated, for leak tests. */
function richSnapshot(): AscSnapshot {
  return {
    screenshots: undefined,
    previews: {
      devices: [
        { previewType: "APP_IPHONE_67", assetState: ["COMPLETE"], previewUrls: ["https://secret.example/preview1.mp4"] },
        { previewType: "APP_IPAD_PRO_3GEN_129", assetState: ["COMPLETE"], previewUrls: ["https://secret.example/preview2.mp4"] },
      ],
      usedLocale: "en-US",
    } as unknown as AscSnapshot["previews"],
    appInfo: {
      locales: [
        {
          locale: "en-US",
          name: "Weatherly",
          subtitle: "Hyperlocal forecasts",
          privacyPolicyUrl: "https://weatherly.example/privacy",
          privacyPolicyText: "We collect your precise location and sell it to nobody, promise. SECRET POLICY TEXT.",
        },
      ],
      primaryCategory: { id: "WEATHER", name: "Weather" },
      secondaryCategory: { id: "UTILITIES", name: "Utilities" },
    },
    versionState: {
      current: { id: "v1", versionString: "3.2.1", appStoreState: "READY_FOR_SALE" },
      all: [{ id: "v1", versionString: "3.2.1", appStoreState: "READY_FOR_SALE" }],
    },
    pricing: {
      pricing: { baseTerritoryPrice: 4.99, baseTerritory: "USA" },
      iaps: [{ id: "iap1", name: "Pro Monthly", productId: "com.weatherly.pro" }],
    } as unknown as AscSnapshot["pricing"],
    ageRating: { ageRating: "FOUR_PLUS" },
    customProductPages: { pages: [{ id: "cpp1", name: "Summer Promo" }] } as unknown as AscSnapshot["customProductPages"],
    locales: [
      { locale: "en-US", name: "Weatherly", subtitle: "Hyperlocal forecasts", keywords: "weather,forecast,rain" },
      { locale: "de-DE", name: "Weatherly", subtitle: "Lokale Vorhersagen", keywords: "wetter,vorhersage" },
    ] as unknown as AscSnapshot["locales"],
    errors: [],
  };
}

describe("buildAscContext", () => {
  it("extracts the safe display scalars from a rich snapshot", () => {
    const ctx = buildAscContext(richSnapshot());
    expect(ctx).toEqual({
      category: "Weather",
      secondaryCategory: "Utilities",
      ageRating: "FOUR_PLUS",
      versionState: "READY_FOR_SALE",
      localeCount: 2,
      previewDeviceCount: 2,
    });
  });

  it("returns undefined for a no-key run (no snapshot)", () => {
    expect(buildAscContext(undefined)).toBeUndefined();
  });

  it("degrades gracefully when surfaces are absent — only present keys appear", () => {
    const ctx = buildAscContext({ errors: [] });
    // No surfaces read ⇒ an empty (but defined) context, never a throw.
    expect(ctx).toEqual({});
  });

  it("falls back to the category id when the name is absent", () => {
    const snap = richSnapshot();
    snap.appInfo = { locales: [], primaryCategory: { id: "WEATHER" } };
    const ctx = buildAscContext(snap);
    expect(ctx?.category).toBe("WEATHER");
  });

  // ── the privacy boundary: NOTHING sensitive may appear ────────────────────
  it("never leaks pricing, locale copy, privacy-policy text, or asset URLs", () => {
    const ctx = buildAscContext(richSnapshot());
    const serialized = JSON.stringify(ctx);
    // raw pricing number
    expect(serialized).not.toContain("4.99");
    // privacy-policy URL + text
    expect(serialized).not.toContain("weatherly.example/privacy");
    expect(serialized).not.toContain("SECRET POLICY TEXT");
    // full locale copy (keywords / subtitle strings)
    expect(serialized).not.toContain("forecast,rain");
    expect(serialized).not.toContain("Hyperlocal forecasts");
    // asset URLs
    expect(serialized).not.toContain("secret.example");
    // IAP product ids / names
    expect(serialized).not.toContain("com.weatherly.pro");
  });

  it("only ever carries the allow-listed keys", () => {
    const ctx = buildAscContext(richSnapshot());
    for (const key of Object.keys(ctx ?? {})) {
      expect(FORBIDDEN_CONTEXT_KEYS).not.toContain(key);
    }
    const allowed = new Set([
      "category",
      "secondaryCategory",
      "ageRating",
      "versionState",
      "localeCount",
      "previewDeviceCount",
    ]);
    for (const key of Object.keys(ctx ?? {})) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});
