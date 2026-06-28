import { describe, expect, it } from "vitest";
import { appStoreAdapter, mapItunesToListing } from "./appStoreAdapter.js";
import type { FetchFn, ItunesResult } from "./itunes.js";
import { APP_STORE_PROFILE } from "./store/profiles.js";

const RESULT: ItunesResult = {
  bundleId: "com.calm.calmapp",
  trackId: 571800810,
  trackName: "Calm",
  description: "Calm is the #1 app for sleep and meditation.",
  genres: ["Health & Fitness", "Lifestyle"],
  screenshotUrls: ["https://is1.mzstatic.com/a/1290x2796bb.png"],
  ipadScreenshotUrls: ["https://is1.mzstatic.com/a/2048x2732bb.png"],
};

/** A FetchFn returning a fixed iTunes JSON payload for any URL. */
function itunesFetch(results: ItunesResult[]): FetchFn {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ resultCount: results.length, results }),
  });
}

describe("mapItunesToListing", () => {
  const listing = mapItunesToListing("com.calm.calmapp", RESULT);

  it("maps an App Store listing with title + long description", () => {
    expect(listing.store).toBe("appstore");
    expect(listing.appId).toBe("com.calm.calmapp");
    expect(listing.title).toBe("Calm");
    expect(listing.longDescription).toContain("sleep and meditation");
  });

  it("groups iPhone + iPad screenshots by device family", () => {
    expect(listing.screenshots).toEqual([
      { family: "iphone", urls: RESULT.screenshotUrls },
      { family: "ipad", urls: RESULT.ipadScreenshotUrls },
    ]);
  });

  it("leaves subtitle + keyword field UNMEASURED (null) — not in the public API", () => {
    expect(listing.tagline).toBeNull();
    expect(listing.keywordField).toBeNull();
  });

  it("is marked unreliable — public iTunes data, empty ≠ zero (#41)", () => {
    expect(listing.reliable).toBe(false);
  });

  it("maps an undefined result to an all-null listing (graceful)", () => {
    const empty = mapItunesToListing("com.x", undefined);
    expect(empty.title).toBeNull();
    expect(empty.longDescription).toBeNull();
    expect(empty.screenshots).toEqual([]);
    expect(empty.category).toBeNull();
  });
});

describe("appStoreAdapter", () => {
  it("exposes the App Store profile", () => {
    expect(appStoreAdapter(itunesFetch([])).profile).toBe(APP_STORE_PROFILE);
  });

  it("readListing looks up by bundle id and maps to a NormalizedListing", async () => {
    const listing = await appStoreAdapter(itunesFetch([RESULT])).readListing("com.calm.calmapp");
    expect(listing.title).toBe("Calm");
    expect(listing.store).toBe("appstore");
    expect(listing.screenshots[0]?.family).toBe("iphone");
  });

  it("resolve delegates to the iTunes resolver (bundle id → resolved)", async () => {
    const res = await appStoreAdapter(itunesFetch([RESULT])).resolve("com.calm.calmapp");
    expect(res.kind).toBe("resolved");
    expect(res.candidates[0]?.bundleId).toBe("com.calm.calmapp");
  });
});
