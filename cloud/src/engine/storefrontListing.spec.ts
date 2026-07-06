import { describe, it, expect } from "vitest";
import {
  extractStorefrontListing,
  fetchStorefrontListing,
} from "./storefrontListing.js";
import type { FetchFn } from "./itunes.js";

/** Build a storefront page around a serialized-server-data payload. */
function page(data: Record<string, unknown>): string {
  return [
    "<html><head></head><body>",
    '<script type="application/json" id="serialized-server-data">',
    JSON.stringify({ data: [{ data }] }),
    "</script>",
    "</body></html>",
  ].join("");
}

const shot = (base: string) => ({
  screenshot: {
    template: `https://is1-ssl.mzstatic.com/image/thumb/${base}/{w}x{h}{c}.{f}`,
    width: 1290,
    height: 2796,
  },
});

const FULL_PAGE = page({
  lockup: { subtitle: "Stoic calm for atheists" },
  shelfMapping: {
    product_media_phone_: {
      items: [shot("P1/v4/aa/APP_IPHONE_65_01.png"), shot("P1/v4/bb/APP_IPHONE_65_02.png")],
    },
    product_media_pad_: { items: [shot("P2/v4/cc/pad-hero.png")] },
    productRatings: {
      items: [{ ratingAverage: 4.6, totalNumberOfRatings: 128, ratingCounts: [1, 2, 5, 20, 100] }],
    },
    mostRecentVersion: { items: [{ text: "Welcome to Heathen.\n\n- 366 daily quotes" }] },
    privacyTypes: { items: [{ identifier: "DATA_NOT_COLLECTED", title: "Data Not Collected" }] },
    information: {
      items: [
        { title: "Category", items: [{ text: "Lifestyle" }] },
        { title: "Languages", items: [{ text: "English, German" }] },
        {
          title: "In-App Purchases",
          items: [{ textPairs: [["Heathen Pro Yearly", "$29.99"], ["Heathen Pro Monthly", "$4.99"]] }],
        },
      ],
    },
    similarItems: {
      items: [
        {
          bundleId: "molozhenko.Sober",
          title: "Sober not Sorry",
          subtitle: "Track your sober days",
          rating: 5,
          ratingCount: 1,
        },
        { noBundle: true }, // malformed entry is skipped, not fatal
      ],
    },
    moreByDeveloper: {
      items: [{ bundleId: "com.airowe.mangia", title: "Mangia - Recipe Manager" }],
    },
  },
});

describe("extractStorefrontListing — the full bundle", () => {
  const out = extractStorefrontListing(FULL_PAGE)!;

  it("reads the subtitle (public, but absent from the lookup API)", () => {
    expect(out.subtitle).toBe("Stoic calm for atheists");
  });

  it("reads the ratings histogram", () => {
    expect(out.ratings).toEqual({ average: 4.6, count: 128, histogram: [1, 2, 5, 20, 100] });
  });

  it("reads What's New text", () => {
    expect(out.whatsNew).toContain("366 daily quotes");
  });

  it("reads privacy label identifiers", () => {
    expect(out.privacyLabels).toEqual(["DATA_NOT_COLLECTED"]);
  });

  it("reads languages (splitting comma lists) and category", () => {
    expect(out.languages).toEqual(["English", "German"]);
    expect(out.category).toBe("Lifestyle");
  });

  it("reads IAP names + prices", () => {
    expect(out.inAppPurchases).toEqual([
      { name: "Heathen Pro Yearly", price: "$29.99" },
      { name: "Heathen Pro Monthly", price: "$4.99" },
    ]);
  });

  it("reads similar apps (Apple's graph) skipping malformed entries", () => {
    expect(out.similarApps).toEqual([
      {
        bundleId: "molozhenko.Sober",
        name: "Sober not Sorry",
        subtitle: "Track your sober days",
        rating: 5,
        ratingCount: 1,
      },
    ]);
  });

  it("reads the seller's other apps", () => {
    expect(out.moreByDeveloper).toEqual([
      { bundleId: "com.airowe.mangia", name: "Mangia - Recipe Manager" },
    ]);
  });

  it("reads phone + pad shots as loadable {w}x{h}bb templates, in shelf order", () => {
    expect(out.shots).toEqual({
      screenshotUrls: [
        "https://is1-ssl.mzstatic.com/image/thumb/P1/v4/aa/APP_IPHONE_65_01.png/{w}x{h}bb.png",
        "https://is1-ssl.mzstatic.com/image/thumb/P1/v4/bb/APP_IPHONE_65_02.png/{w}x{h}bb.png",
      ],
      ipadScreenshotUrls: [
        "https://is1-ssl.mzstatic.com/image/thumb/P2/v4/cc/pad-hero.png/{w}x{h}bb.png",
      ],
    });
  });
});

describe("extractStorefrontListing — per-field degradation", () => {
  it("omits every field that fails to parse, without failing the others", () => {
    const out = extractStorefrontListing(
      page({
        lockup: { subtitle: 42 }, // wrong type → subtitle absent
        shelfMapping: {
          productRatings: { items: [{ ratingAverage: "n/a" }] }, // wrong type
          product_media_phone_xx: { items: [shot("P/v4/x/a.png")] }, // suffix-keyed shelf still read
        },
      }),
    )!;
    expect(out.subtitle).toBeUndefined();
    expect(out.ratings).toBeUndefined();
    expect(out.shots!.screenshotUrls).toHaveLength(1);
  });

  it("returns an empty bundle (not null) when shelves are empty but the blob parses", () => {
    const out = extractStorefrontListing(page({ shelfMapping: {} }));
    expect(out).toEqual({});
  });

  it("returns null when the page has no serialized-server-data blob", () => {
    expect(extractStorefrontListing("<html><body>store closed</body></html>")).toBeNull();
  });

  it("returns null on a malformed JSON blob rather than throwing", () => {
    expect(
      extractStorefrontListing('<script id="serialized-server-data">{"data": [{]}</script>'),
    ).toBeNull();
  });

  it("omits shots entirely when media shelves carry none (never an empty false-positive)", () => {
    const out = extractStorefrontListing(
      page({ shelfMapping: { product_media_phone_: { items: [] } } }),
    )!;
    expect(out.shots).toBeUndefined();
  });

  it("skips shot items without a template but keeps the rest", () => {
    const out = extractStorefrontListing(
      page({
        shelfMapping: {
          product_media_phone_: { items: [{ screenshot: {} }, shot("P/v4/y/b.png")] },
        },
      }),
    )!;
    expect(out.shots!.screenshotUrls).toHaveLength(1);
  });
});

describe("fetchStorefrontListing", () => {
  const okFetch =
    (body: string): FetchFn =>
    async () =>
      ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body }) as never;

  it("fetches the page and extracts", async () => {
    const out = await fetchStorefrontListing(okFetch(FULL_PAGE), "https://apps.apple.com/us/app/x/id1");
    expect(out!.subtitle).toBe("Stoic calm for atheists");
    expect(out!.shots!.screenshotUrls).toHaveLength(2);
  });

  it("returns null on a non-200 response", async () => {
    const fetchFn: FetchFn = async () =>
      ({ ok: false, status: 403, headers: { get: () => null }, text: async () => "" }) as never;
    expect(await fetchStorefrontListing(fetchFn, "https://apps.apple.com/us/app/x/id1")).toBeNull();
  });

  it("returns null when fetch throws (offline audit must not fail)", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error("net down");
    };
    expect(await fetchStorefrontListing(fetchFn, "https://apps.apple.com/us/app/x/id1")).toBeNull();
  });
});
