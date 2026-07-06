import { describe, it, expect } from "vitest";
import { extractStorefrontShots, fetchStorefrontShots } from "./storefrontShots.js";
import type { FetchFn } from "./itunes.js";

/** Build a storefront page around a serialized-server-data payload. */
function page(shelfMapping: Record<string, unknown>): string {
  const data = { data: [{ data: { shelfMapping } }] };
  return [
    "<html><head></head><body>",
    '<script type="application/json" id="serialized-server-data">',
    JSON.stringify(data),
    "</script>",
    "</body></html>",
  ].join("");
}

const shot = (base: string, w = 1290, h = 2796) => ({
  $kind: "screenshot",
  screenshot: {
    template: `https://is1-ssl.mzstatic.com/image/thumb/${base}/{w}x{h}{c}.{f}`,
    width: w,
    height: h,
  },
});

const PHONE_SHELF = {
  items: [shot("P1/v4/aa/APP_IPHONE_65_01.png"), shot("P1/v4/bb/APP_IPHONE_65_02.png")],
};
const PAD_SHELF = { items: [shot("P2/v4/cc/pad-hero.png", 2048, 2732)] };

describe("extractStorefrontShots", () => {
  it("pulls phone + pad sets from the media shelves, in shelf order, as loadable {w}x{h}bb templates", () => {
    const html = page({
      product_media_phone_: PHONE_SHELF,
      product_media_pad_: PAD_SHELF,
      unrelated_shelf: { items: [{ lockup: true }] },
    });
    const out = extractStorefrontShots(html);
    expect(out).not.toBeNull();
    expect(out!.screenshotUrls).toEqual([
      "https://is1-ssl.mzstatic.com/image/thumb/P1/v4/aa/APP_IPHONE_65_01.png/{w}x{h}bb.png",
      "https://is1-ssl.mzstatic.com/image/thumb/P1/v4/bb/APP_IPHONE_65_02.png/{w}x{h}bb.png",
    ]);
    expect(out!.ipadScreenshotUrls).toEqual([
      "https://is1-ssl.mzstatic.com/image/thumb/P2/v4/cc/pad-hero.png/{w}x{h}bb.png",
    ]);
  });

  it("tolerates shelf-key suffixes (locale/variant) via prefix match", () => {
    const html = page({ product_media_phone_xx: PHONE_SHELF });
    expect(extractStorefrontShots(html)!.screenshotUrls).toHaveLength(2);
  });

  it("returns null when the page has no serialized-server-data blob", () => {
    expect(extractStorefrontShots("<html><body>store closed</body></html>")).toBeNull();
  });

  it("returns null when shelves exist but carry no screenshots (never an empty false-positive)", () => {
    const html = page({ product_media_phone_: { items: [] } });
    expect(extractStorefrontShots(html)).toBeNull();
  });

  it("returns null on a malformed JSON blob rather than throwing", () => {
    const html =
      '<script id="serialized-server-data">{"data": [{]}</script>';
    expect(extractStorefrontShots(html)).toBeNull();
  });

  it("skips items without a template but keeps the rest", () => {
    const html = page({
      product_media_phone_: { items: [{ screenshot: {} }, ...PHONE_SHELF.items] },
    });
    expect(extractStorefrontShots(html)!.screenshotUrls).toHaveLength(2);
  });
});

describe("fetchStorefrontShots", () => {
  const okFetch =
    (body: string): FetchFn =>
    async () =>
      ({ ok: true, status: 200, text: async () => body, json: async () => ({}) }) as never;

  it("fetches the page and extracts", async () => {
    const html = page({ product_media_phone_: PHONE_SHELF });
    const out = await fetchStorefrontShots(okFetch(html), "https://apps.apple.com/us/app/x/id1");
    expect(out!.screenshotUrls).toHaveLength(2);
  });

  it("returns null on a non-200 response", async () => {
    const fetchFn: FetchFn = async () =>
      ({ ok: false, status: 403, text: async () => "", json: async () => ({}) }) as never;
    expect(await fetchStorefrontShots(fetchFn, "https://apps.apple.com/us/app/x/id1")).toBeNull();
  });

  it("returns null when fetch throws (offline audit must not fail)", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error("net down");
    };
    expect(await fetchStorefrontShots(fetchFn, "https://apps.apple.com/us/app/x/id1")).toBeNull();
  });
});
