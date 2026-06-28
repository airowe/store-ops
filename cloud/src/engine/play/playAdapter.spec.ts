import { describe, expect, it } from "vitest";
import { GOOGLE_PLAY_PROFILE } from "../store/profiles.js";
import { playAdapter } from "./playAdapter.js";
import type { PlayPageSource } from "./playWebSource.js";

const PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "SoftwareApplication",
  name: "Calm - Sleep, Meditate, Relax",
  description: "Guided meditation and sleep stories.",
  applicationCategory: "HEALTH_AND_FITNESS",
  screenshot: ["https://play-lh.googleusercontent.com/s1"],
})}</script></head></html>`;

/** A fake source that returns a fixed page and records what was requested. */
function fakeSource(html = PAGE) {
  const detailCalls: string[] = [];
  const source: PlayPageSource = {
    detail: async (pkg) => {
      detailCalls.push(pkg);
      return html;
    },
    search: async () => "",
  };
  return { source, detailCalls };
}

describe("playAdapter", () => {
  it("exposes the Google Play profile", () => {
    expect(playAdapter(fakeSource().source).profile).toBe(GOOGLE_PLAY_PROFILE);
  });

  it("resolves a package id by reading the listing for its name", async () => {
    const res = await playAdapter(fakeSource().source).resolve("com.calm.android");
    expect(res.kind).toBe("resolved");
    expect(res.candidates[0]?.bundleId).toBe("com.calm.android");
    expect(res.candidates[0]?.name).toBe("Calm - Sleep, Meditate, Relax");
    expect(res.candidates[0]?.genres).toContain("HEALTH_AND_FITNESS");
  });

  it("resolves a play.google.com URL to its package", async () => {
    const res = await playAdapter(fakeSource().source).resolve(
      "https://play.google.com/store/apps/details?id=com.calm.android&hl=en",
    );
    expect(res.kind).toBe("resolved");
    expect(res.candidates[0]?.bundleId).toBe("com.calm.android");
  });

  it("returns not-found for a plain NAME query (name search is deferred, not faked)", async () => {
    const res = await playAdapter(fakeSource().source).resolve("meditation app");
    expect(res.kind).toBe("not-found");
    expect(res.candidates).toEqual([]);
  });

  it("readListing returns a NormalizedListing for the package", async () => {
    const { source, detailCalls } = fakeSource();
    const listing = await playAdapter(source).readListing("com.calm.android");
    expect(listing.store).toBe("googleplay");
    expect(listing.title).toBe("Calm - Sleep, Meditate, Relax");
    expect(listing.keywordField).toBeNull();
    expect(detailCalls).toEqual(["com.calm.android"]);
  });
});
