import { describe, expect, it } from "vitest";
import { CHAR_LIMITS } from "../constants.js";
import {
  APP_STORE_PROFILE,
  GOOGLE_PLAY_PROFILE,
  PLAY_CHAR_LIMITS,
  getSurface,
  indexedSurfaces,
  primaryDeviceFamily,
  profileFor,
  surfaceByRole,
  surfacesByRole,
} from "./profiles.js";

describe("App Store profile (unchanged iOS model)", () => {
  it("carries a keyword field and the 30/30/100 budget from CHAR_LIMITS", () => {
    expect(APP_STORE_PROFILE.hasKeywordField).toBe(true);
    expect(getSurface(APP_STORE_PROFILE, "name")?.limit).toBe(CHAR_LIMITS.name);
    expect(getSurface(APP_STORE_PROFILE, "subtitle")?.limit).toBe(CHAR_LIMITS.subtitle);
    expect(getSurface(APP_STORE_PROFILE, "keywords")?.limit).toBe(CHAR_LIMITS.keywords);
  });

  it("models the keyword field as an indexed keywordfield role", () => {
    const kw = getSurface(APP_STORE_PROFILE, "keywords");
    expect(kw?.role).toBe("keywordfield");
    expect(kw?.indexed).toBe(true);
  });

  it("does NOT index the description for search (iOS-specific)", () => {
    expect(getSurface(APP_STORE_PROFILE, "description")?.indexed).toBe(false);
    expect(getSurface(APP_STORE_PROFILE, "promo")?.indexed).toBe(false);
  });

  it("has iphone(primary)/ipad device families and targets `deliver`", () => {
    expect(APP_STORE_PROFILE.deviceFamilies.map((d) => d.key)).toEqual(["iphone", "ipad"]);
    expect(primaryDeviceFamily(APP_STORE_PROFILE)?.key).toBe("iphone");
    expect(APP_STORE_PROFILE.fastlaneTool).toBe("deliver");
  });
});

describe("Google Play profile — the three Android truths", () => {
  it("has NO keyword field (the load-bearing difference)", () => {
    expect(GOOGLE_PLAY_PROFILE.hasKeywordField).toBe(false);
    // and no surface plays the keywordfield role
    expect(surfacesByRole(GOOGLE_PLAY_PROFILE, "keywordfield")).toEqual([]);
    expect(getSurface(GOOGLE_PLAY_PROFILE, "keywords")).toBeUndefined();
  });

  it("indexes the long description — it IS the keyword surface (inverse of iOS)", () => {
    const desc = getSurface(GOOGLE_PLAY_PROFILE, "description");
    expect(desc?.indexed).toBe(true);
    expect(desc?.role).toBe("longform");
    expect(desc?.limit).toBe(PLAY_CHAR_LIMITS.description);
    expect(desc?.limit).toBe(4000);
  });

  it("uses the Play title(30)/short(80)/long(4000) budget", () => {
    expect(getSurface(GOOGLE_PLAY_PROFILE, "title")?.limit).toBe(30);
    expect(getSurface(GOOGLE_PLAY_PROFILE, "shortDescription")?.limit).toBe(80);
    expect(getSurface(GOOGLE_PLAY_PROFILE, "description")?.limit).toBe(4000);
  });

  it("maps the tagline role to the short description (not an iOS subtitle)", () => {
    expect(surfaceByRole(GOOGLE_PLAY_PROFILE, "tagline")?.field).toBe("shortDescription");
    expect(surfaceByRole(GOOGLE_PLAY_PROFILE, "title")?.field).toBe("title");
  });

  it("has phone(primary)/tablet7/tablet10 families with NO iPad, and targets `supply`", () => {
    expect(GOOGLE_PLAY_PROFILE.deviceFamilies.map((d) => d.key)).toEqual([
      "phone",
      "tablet7",
      "tablet10",
    ]);
    expect(GOOGLE_PLAY_PROFILE.deviceFamilies.some((d) => d.key === "ipad")).toBe(false);
    expect(primaryDeviceFamily(GOOGLE_PLAY_PROFILE)?.key).toBe("phone");
    expect(GOOGLE_PLAY_PROFILE.fastlaneTool).toBe("supply");
  });
});

describe("profile invariants (both stores)", () => {
  it.each([APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE])(
    "%# has exactly one primary device family",
    (profile) => {
      expect(profile.deviceFamilies.filter((d) => d.primary)).toHaveLength(1);
    },
  );

  it.each([APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE])(
    "%# has exactly one title and one tagline surface",
    (profile) => {
      expect(surfacesByRole(profile, "title")).toHaveLength(1);
      expect(surfacesByRole(profile, "tagline")).toHaveLength(1);
    },
  );

  it.each([APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE])(
    "%# only declares a keywordfield surface when hasKeywordField is true",
    (profile) => {
      const hasKwSurface = surfacesByRole(profile, "keywordfield").length > 0;
      expect(hasKwSurface).toBe(profile.hasKeywordField);
    },
  );

  it("every field limit is a positive integer", () => {
    for (const profile of [APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE]) {
      for (const f of profile.fields) {
        expect(Number.isInteger(f.limit)).toBe(true);
        expect(f.limit).toBeGreaterThan(0);
      }
    }
  });
});

describe("profile query helpers", () => {
  it("profileFor resolves a StoreId to its profile", () => {
    expect(profileFor("appstore")).toBe(APP_STORE_PROFILE);
    expect(profileFor("googleplay")).toBe(GOOGLE_PLAY_PROFILE);
  });

  it("indexedSurfaces returns only search-indexed fields", () => {
    // iOS: name, subtitle, keywords (NOT promo/description).
    expect(indexedSurfaces(APP_STORE_PROFILE).map((f) => f.field)).toEqual([
      "name",
      "subtitle",
      "keywords",
    ]);
    // Play: title, shortDescription, description (the long desc is indexed).
    expect(indexedSurfaces(GOOGLE_PLAY_PROFILE).map((f) => f.field)).toEqual([
      "title",
      "shortDescription",
      "description",
    ]);
  });

  it("getSurface returns undefined for an absent field", () => {
    expect(getSurface(GOOGLE_PLAY_PROFILE, "keywords")).toBeUndefined();
    expect(getSurface(APP_STORE_PROFILE, "shortDescription")).toBeUndefined();
  });
});
