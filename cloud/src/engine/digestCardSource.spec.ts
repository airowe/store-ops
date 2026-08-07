/**
 * The digest card is populated from the app's PUBLIC App Store listing — the
 * same free iTunes Lookup the audit already uses. No credentials, so it works
 * for every app on every tier.
 *
 * The rule the shape enforces: a field Apple did not return is OMITTED, never
 * defaulted. `renderDigestHtml` then renders nothing for it. A missing rating
 * must not become "0.0 ★ (0)", which would read as a real, terrible rating.
 */
import { describe, expect, it, vi } from "vitest";
import { digestCardFor } from "./digestCardSource.js";
import { __setSleep, sleep } from "./itunes.js";

/** A lookup response with only the fields the test names. */
function lookupOk(result: Record<string, unknown>) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ resultCount: 1, results: [result] }),
  })) as unknown as Parameters<typeof digestCardFor>[0];
}

const FULL = {
  bundleId: "com.chat.swoop",
  trackName: "Swoop: Chat & Meet IRL",
  artistName: "Swoopchat LLC",
  version: "1.0.33",
  primaryGenreName: "Social Networking",
  formattedPrice: "Free",
  averageUserRating: 5,
  userRatingCount: 2,
  artworkUrl512: "https://cdn/icon512.jpg",
  screenshotUrls: ["https://cdn/1.png", "https://cdn/2.png", "https://cdn/3.png"],
};

describe("digestCardFor", () => {
  it("maps a full listing onto the card", async () => {
    const card = await digestCardFor(lookupOk(FULL), "com.chat.swoop", "US");
    expect(card).toMatchObject({
      developer: "Swoopchat LLC",
      version: "1.0.33",
      category: "Social Networking",
      price: "Free",
      rating: { average: 5, count: 2 },
      iconUrl: "https://cdn/icon512.jpg",
      screenshotUrls: FULL.screenshotUrls,
    });
  });

  it("falls back through the artwork sizes Apple actually returns", async () => {
    const { artworkUrl512: _omit, ...noBig } = FULL;
    const card = await digestCardFor(
      lookupOk({ ...noBig, artworkUrl100: "https://cdn/icon100.jpg" }),
      "com.chat.swoop",
      "US",
    );
    expect(card?.iconUrl).toBe("https://cdn/icon100.jpg");
  });

  it("omits rating entirely when the app has no ratings — never 0.0 ★ (0)", async () => {
    const { averageUserRating: _a, userRatingCount: _c, ...noRating } = FULL;
    const card = await digestCardFor(lookupOk(noRating), "com.chat.swoop", "US");
    expect(card?.rating).toBeUndefined();
  });

  it("omits each absent field rather than defaulting it", async () => {
    const card = await digestCardFor(lookupOk({ bundleId: "x" }), "x", "US");
    expect(card?.developer).toBeUndefined();
    expect(card?.version).toBeUndefined();
    expect(card?.category).toBeUndefined();
    expect(card?.price).toBeUndefined();
    expect(card?.iconUrl).toBeUndefined();
    expect(card?.screenshotUrls).toBeUndefined();
  });

  it("returns undefined when the app is not found — the digest just has no card", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ resultCount: 0, results: [] }),
    })) as unknown as Parameters<typeof digestCardFor>[0];
    expect(await digestCardFor(fetchFn, "com.nope", "US")).toBeUndefined();
  });

  it("returns undefined on a lookup failure instead of throwing — a digest must still send", async () => {
    // fetchJson retries a network error 3x with backoff; stub the sleep so the
    // test asserts the swallow, not the ~10s of real waiting.
    const realSleep = sleep;
    __setSleep(async () => {});
    try {
      const fetchFn = vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as Parameters<typeof digestCardFor>[0];
      expect(await digestCardFor(fetchFn, "com.chat.swoop", "US")).toBeUndefined();
    } finally {
      __setSleep(realSleep);
    }
  });

  it("resolves Apple's {w}x{h} screenshot templates so the images actually load", async () => {
    const card = await digestCardFor(
      lookupOk({ ...FULL, screenshotUrls: ["https://cdn/a.png/{w}x{h}bb.{f}"] }),
      "com.chat.swoop",
      "US",
    );
    expect(card?.screenshotUrls?.[0]).not.toContain("{w}");
    expect(card?.screenshotUrls?.[0]).not.toContain("{f}");
  });

  it("queries the requested storefront", async () => {
    const fetchFn = lookupOk(FULL);
    await digestCardFor(fetchFn, "com.chat.swoop", "GB");
    const url = String((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toContain("bundleId=com.chat.swoop");
    expect(url).toContain("country=GB");
  });
});
