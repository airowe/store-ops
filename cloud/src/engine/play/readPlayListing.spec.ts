import { describe, expect, it } from "vitest";
import type { PlayDetailRaw } from "./playListingParse.js";
import { mapPlayDetailToListing, readPlayListing } from "./readPlayListing.js";
import type { PlayPageOpts, PlayPageSource } from "./playWebSource.js";

const RAW: PlayDetailRaw = {
  packageName: "com.spotify.music",
  title: "Spotify: Music and Podcasts",
  description: "Listen to music and podcasts.",
  icon: "https://play-lh.googleusercontent.com/icon",
  screenshots: ["https://play-lh.googleusercontent.com/s1", "https://play-lh.googleusercontent.com/s2"],
  category: "MUSIC_AND_AUDIO",
  ratingValue: 4.3,
  ratingCount: 29680041,
  price: "0",
  priceCurrency: "USD",
};

describe("mapPlayDetailToListing — honesty contract", () => {
  const listing = mapPlayDetailToListing(RAW);

  it("marks it a googleplay listing keyed by package name", () => {
    expect(listing.store).toBe("googleplay");
    expect(listing.appId).toBe("com.spotify.music");
  });

  it("NEVER carries a keyword field — Play has none (null, not empty)", () => {
    expect(listing.keywordField).toBeNull();
  });

  it("leaves the short-description tagline unmeasured (null), not blank", () => {
    expect(listing.tagline).toBeNull();
  });

  it("maps the long description and title through", () => {
    expect(listing.title).toBe("Spotify: Music and Podcasts");
    expect(listing.longDescription).toBe("Listen to music and podcasts.");
  });

  it("attaches screenshots to the primary phone family", () => {
    expect(listing.screenshots).toEqual([
      { family: "phone", urls: RAW.screenshots },
    ]);
  });

  it("is marked unreliable — scraped public data, empty ≠ zero (#41)", () => {
    expect(listing.reliable).toBe(false);
  });

  it("emits NO screenshot group when there are no screenshots", () => {
    expect(mapPlayDetailToListing({ ...RAW, screenshots: [] }).screenshots).toEqual([]);
  });

  it("maps a missing category to null, not an empty object", () => {
    expect(mapPlayDetailToListing({ ...RAW, category: null }).category).toBeNull();
  });
});

describe("readPlayListing — fetch via the injected source, no network", () => {
  /** A fake source recording the detail() args and returning a fixed page. */
  function fakeSource(html: string) {
    const calls: { packageName: string; opts?: PlayPageOpts }[] = [];
    const source: PlayPageSource = {
      detail: async (packageName, opts) => {
        calls.push({ packageName, ...(opts ? { opts } : {}) });
        return html;
      },
      search: async () => "",
    };
    return { source, calls };
  }

  const PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "SoftwareApplication",
    name: "Spotify",
    description: "Music app",
    screenshot: ["https://x/s1"],
  })}</script></head></html>`;

  it("reads + parses + maps a listing end to end", async () => {
    const { source } = fakeSource(PAGE);
    const listing = await readPlayListing(source, "com.spotify.music");
    expect(listing.store).toBe("googleplay");
    expect(listing.title).toBe("Spotify");
    expect(listing.longDescription).toBe("Music app");
    expect(listing.keywordField).toBeNull();
    expect(listing.screenshots[0]?.family).toBe("phone");
  });

  it("passes country/lang opts through to the page source", async () => {
    const { source, calls } = fakeSource(PAGE);
    await readPlayListing(source, "com.spotify.music", { country: "GB", lang: "en" });
    expect(calls[0]).toEqual({
      packageName: "com.spotify.music",
      opts: { country: "GB", lang: "en" },
    });
  });
});
