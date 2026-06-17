import { describe, expect, it } from "vitest";
import {
  readAscScreenshots,
  classifyDevice,
  type AscScreenshotSet,
  readAscPreviews,
  type AscPreviewsResult,
  readAscPricingAndIAP,
  type AppPricing,
} from "./ascRead.js";
import { AscWriteError, type FetchLike } from "./ascWrite.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Realistic ASC JSON:API stubs for the screenshot read graph:
 *   versions → localizations → screenshot sets (per device) → screenshots.
 *
 * The fetch stub is keyed by URL fragment, mirroring the live endpoint shapes.
 */
type Routes = {
  versions: unknown;
  localizations: unknown;
  /** keyed by localization id → that locale's screenshot sets */
  sets: Record<string, unknown>;
  /** keyed by set id → that set's screenshots */
  screenshots: Record<string, unknown>;
  /** status overrides keyed by URL fragment, to simulate 404/4xx */
  status?: Record<string, number>;
};

function makeFetch(routes: Routes) {
  const calls: string[] = [];
  const statusFor = (url: string): number | undefined => {
    for (const frag of Object.keys(routes.status ?? {})) {
      if (url.includes(frag)) return routes.status?.[frag];
    }
    return undefined;
  };
  const fetchFn: FetchLike = async (url: string) => {
    calls.push(url);
    const s = statusFor(url);
    if (s && s >= 400) return json({ errors: [{ detail: "nope" }] }, s);

    if (url.includes("/appStoreVersions?")) return json(routes.versions);
    if (url.includes("/appStoreVersionLocalizations?")) return json(routes.localizations);
    // /appStoreVersionLocalizations/{id}/appScreenshotSets
    const setMatch = url.match(/appStoreVersionLocalizations\/([^/]+)\/appScreenshotSets/);
    if (setMatch) return json(routes.sets[setMatch[1]!] ?? { data: [] });
    // /appScreenshotSets/{id}/appScreenshots
    const ssMatch = url.match(/appScreenshotSets\/([^/]+)\/appScreenshots/);
    if (ssMatch) return json(routes.screenshots[ssMatch[1]!] ?? { data: [] });
    return json({}, 404);
  };
  return { fetchFn, calls };
}

const TEMPLATE_67 =
  "https://is1-ssl.mzstatic.com/image/thumb/abc/source/{w}x{h}{c}.{f}";
const TEMPLATE_IPAD =
  "https://is2-ssl.mzstatic.com/image/thumb/xyz/source/{w}x{h}{c}.{f}";

function happyRoutes(): Routes {
  return {
    versions: {
      data: [
        { id: "V_LIVE", attributes: { appStoreState: "READY_FOR_SALE" } },
        { id: "V_EDIT", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } },
      ],
    },
    localizations: {
      data: [
        { id: "L_DE", attributes: { locale: "de-DE" } },
        { id: "L_US", attributes: { locale: "en-US" } },
      ],
    },
    sets: {
      L_US: {
        data: [
          { id: "SET_67", attributes: { screenshotDisplayType: "APP_IPHONE_67" } },
          { id: "SET_55", attributes: { screenshotDisplayType: "APP_IPHONE_55" } },
          { id: "SET_IPAD", attributes: { screenshotDisplayType: "APP_IPAD_PRO_3GEN_129" } },
        ],
      },
    },
    screenshots: {
      SET_67: {
        data: [
          {
            id: "SS1",
            attributes: {
              assetDeliveryState: { state: "COMPLETE" },
              imageAsset: { templateUrl: TEMPLATE_67, width: 1290, height: 2796 },
            },
          },
          {
            id: "SS2",
            attributes: {
              assetDeliveryState: { state: "COMPLETE" },
              imageAsset: { templateUrl: TEMPLATE_67, width: 1290, height: 2796 },
            },
          },
        ],
      },
      SET_55: {
        data: [
          {
            id: "SS3",
            attributes: {
              assetDeliveryState: { state: "COMPLETE" },
              imageAsset: { templateUrl: TEMPLATE_67, width: 1242, height: 2208 },
            },
          },
        ],
      },
      SET_IPAD: {
        data: [
          {
            id: "SS4",
            attributes: {
              assetDeliveryState: { state: "COMPLETE" },
              imageAsset: { templateUrl: TEMPLATE_IPAD, width: 2048, height: 2732 },
            },
          },
        ],
      },
    },
  };
}

describe("classifyDevice", () => {
  it("maps every iPhone display type to iphone", () => {
    for (const d of ["APP_IPHONE_67", "APP_IPHONE_65", "APP_IPHONE_58", "APP_IPHONE_55", "APP_IPHONE_47", "APP_IPHONE_40"]) {
      expect(classifyDevice(d)).toBe("iphone");
    }
  });

  it("maps iPad display types to ipad", () => {
    for (const d of ["APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_129", "APP_IPAD_105", "APP_IPAD_97"]) {
      expect(classifyDevice(d)).toBe("ipad");
    }
  });

  it("returns other for non-phone/tablet surfaces", () => {
    expect(classifyDevice("APP_WATCH_SERIES_7")).toBe("other");
    expect(classifyDevice("APP_APPLE_TV")).toBe("other");
    expect(classifyDevice(undefined)).toBe("other");
  });
});

describe("readAscScreenshots — version → locale → sets → screenshots", () => {
  it("returns dataReliable:true (this came from ASC, not the public iTunes API)", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(r.dataReliable).toBe(true);
  });

  it("groups iPhone device types into iphoneScreenshots and iPad into ipadScreenshots", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });

    expect(r.iphoneScreenshots).toHaveLength(2); // 6.7" + 5.5"
    expect(r.iphoneScreenshots.map((s) => s.device)).toEqual(
      expect.arrayContaining(["APP_IPHONE_67", "APP_IPHONE_55"]),
    );
    expect(r.ipadScreenshots).toHaveLength(1);
    expect(r.ipadScreenshots[0]!.device).toBe("APP_IPAD_PRO_3GEN_129");
  });

  it("reports the screenshot count and ordered ids per device set", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    const set67 = r.iphoneScreenshots.find((s) => s.device === "APP_IPHONE_67")!;
    expect(set67.count).toBe(2);
    expect(set67.screenshots.map((ss) => ss.id)).toEqual(["SS1", "SS2"]);
  });

  it("builds imageTemplate from imageAsset.templateUrl and carries dims + delivery state", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    const first = r.iphoneScreenshots.find((s) => s.device === "APP_IPHONE_67")!.screenshots[0]!;
    expect(first.imageTemplate).toBe(TEMPLATE_67);
    expect(first.width).toBe(1290);
    expect(first.height).toBe(2796);
    expect(first.assetDeliveryState).toBe("COMPLETE");
  });

  it("exposes the readable version id and chosen localization in raw", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(r.raw?.versionId).toBe("V_EDIT");
    expect(r.raw?.localization).toEqual({ locale: "en-US", id: "L_US" });
    expect(r.raw?.allSets).toHaveLength(3);
  });

  it("converts cleanly to the screenshotScore Listing shape with dataReliable:true (closes #44)", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    const r: AscScreenshotSet = await readAscScreenshots(fetchFn, {
      token: "JWT",
      appId: "APP1",
      locale: "en-US",
    });
    const listing = {
      screenshotUrls: r.iphoneScreenshots.flatMap((s) => s.screenshots.map((ss) => ss.imageTemplate ?? "")).filter(Boolean),
      ipadScreenshotUrls: r.ipadScreenshots.flatMap((s) => s.screenshots.map((ss) => ss.imageTemplate ?? "")).filter(Boolean),
      dataReliable: true as const,
    };
    expect(listing.screenshotUrls).toHaveLength(3); // SS1 SS2 SS3
    expect(listing.ipadScreenshotUrls).toHaveLength(1); // SS4
    expect(listing.dataReliable).toBe(true);
  });
});

describe("readAscScreenshots — edge cases & graceful degradation", () => {
  it("returns empty arrays (still dataReliable:true) when the app has no screenshots at all", async () => {
    const routes = happyRoutes();
    routes.sets = { L_US: { data: [] } };
    const { fetchFn } = makeFetch(routes);
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(r.iphoneScreenshots).toHaveLength(0);
    expect(r.ipadScreenshots).toHaveLength(0);
    expect(r.dataReliable).toBe(true);
  });

  it("gracefully returns empty arrays when appScreenshotSets 404s (restricted key)", async () => {
    const routes = happyRoutes();
    routes.status = { "/appScreenshotSets": 404 };
    const { fetchFn } = makeFetch(routes);
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(r.iphoneScreenshots).toHaveLength(0);
    expect(r.dataReliable).toBe(true);
  });

  it("omits sets that have zero screenshots (count 0 → not surfaced)", async () => {
    const routes = happyRoutes();
    routes.screenshots = { ...routes.screenshots, SET_55: { data: [] } };
    const { fetchFn } = makeFetch(routes);
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    // 6.7" survives (2 shots), 5.5" is dropped (0 shots)
    expect(r.iphoneScreenshots.map((s) => s.device)).toEqual(["APP_IPHONE_67"]);
  });

  it("skips a screenshot whose templateUrl is missing (pending upload) without crashing", async () => {
    const routes = happyRoutes();
    routes.screenshots = {
      ...routes.screenshots,
      SET_67: {
        data: [
          { id: "SS1", attributes: { imageAsset: { templateUrl: TEMPLATE_67, width: 1290, height: 2796 } } },
          { id: "SS_PENDING", attributes: { assetDeliveryState: { state: "UPLOAD_INCOMPLETE" } } },
        ],
      },
    };
    const { fetchFn } = makeFetch(routes);
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    const set67 = r.iphoneScreenshots.find((s) => s.device === "APP_IPHONE_67")!;
    expect(set67.screenshots.map((ss) => ss.id)).toEqual(["SS1"]);
  });

  it("aggregates ALL localizations' screenshots when no locale is specified", async () => {
    const routes = happyRoutes();
    routes.sets = {
      L_US: { data: [{ id: "SET_US67", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }] },
      L_DE: { data: [{ id: "SET_DE67", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }] },
    };
    routes.screenshots = {
      SET_US67: { data: [{ id: "US1", attributes: { imageAsset: { templateUrl: TEMPLATE_67 } } }] },
      SET_DE67: { data: [{ id: "DE1", attributes: { imageAsset: { templateUrl: TEMPLATE_67 } } }] },
    };
    const { fetchFn } = makeFetch(routes);
    const r = await readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1" });
    const ids = r.iphoneScreenshots.flatMap((s) => s.screenshots.map((ss) => ss.id));
    expect(ids).toEqual(expect.arrayContaining(["US1", "DE1"]));
  });

  it("throws AscWriteError when the app has no versions at all", async () => {
    const routes = happyRoutes();
    routes.versions = { data: [] };
    const { fetchFn } = makeFetch(routes);
    await expect(
      readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" }),
    ).rejects.toThrow(AscWriteError);
  });

  it("throws AscWriteError when the requested locale is absent", async () => {
    const { fetchFn } = makeFetch(happyRoutes());
    await expect(
      readAscScreenshots(fetchFn, { token: "JWT", appId: "APP1", locale: "fr-FR" }),
    ).rejects.toThrow(AscWriteError);
  });

  it("never leaks the token in an auth-failure error (401 on versions)", async () => {
    const routes = happyRoutes();
    routes.status = { "/appStoreVersions?": 401 };
    const { fetchFn } = makeFetch(routes);
    await readAscScreenshots(fetchFn, { token: "SECRET_JWT", appId: "APP1", locale: "en-US" }).catch(
      (e: Error) => {
        expect(e).toBeInstanceOf(AscWriteError);
        expect(e.message).not.toContain("SECRET_JWT");
      },
    );
  });
});

/**
 * Route-matching fetch stub: the LAST matching key wins so that more specific
 * paths (e.g. "/appPreviewSets/") override list paths (e.g. "/appPreviewSets?").
 * Each route entry is { body, status? }.
 */
function mockFetch(routes: Record<string, { body: unknown; status?: number }>): {
  fetchFn: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    // pick the longest matching key so specific routes beat list routes
    const keys = Object.keys(routes)
      .filter((k) => url.includes(k))
      .sort((a, b) => b.length - a.length);
    const hit = keys[0];
    if (!hit) return json({}, 404);
    const { body, status } = routes[hit]!;
    return json(body, status ?? 200);
  }) as FetchLike;
  return { fetchFn, calls };
}

const VERSIONS = {
  "/appStoreVersions?": {
    body: { data: [{ id: "V1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
  },
};

describe("readAscPreviews — version → localization → previewSets → previews", () => {
  it("aggregates preview videos per device for the requested locale", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            { id: "LDE", attributes: { locale: "de-DE" } },
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET1", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SET1",
              attributes: { previewType: "APP_IPHONE_67" },
              relationships: { appPreviews: { data: [{ id: "PREV1", type: "appPreviews" }] } },
            },
          ],
        },
      },
      "/appPreviewSets/SET1/appPreviews?": {
        body: {
          data: [
            {
              id: "PREV1",
              attributes: {
                previewUrl: "https://d3c.example/clip.mp4",
                assetDeliveryState: { state: "COMPLETE" },
                fileSize: 12345678,
                mimeType: "video/mp4",
              },
            },
          ],
        },
      },
    });

    const result: AscPreviewsResult = await readAscPreviews(fetchFn, {
      token: "JWT",
      appId: "APP1",
      locale: "en-US",
    });

    expect(result.usedLocale).toBe("en-US");
    expect(result.devices).toHaveLength(1);
    const d = result.devices[0]!;
    expect(d.previewType).toBe("APP_IPHONE_67");
    expect(d.count).toBe(1);
    expect(d.urls).toEqual(["https://d3c.example/clip.mp4"]);
    expect(d.assetState).toEqual(["COMPLETE"]);
  });

  it("uses the first localization when no locale is requested", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LFIRST",
              attributes: { locale: "fr-FR" },
              relationships: { appPreviewSets: { data: [{ id: "SETF", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LFIRST/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SETF",
              attributes: { previewType: "APP_IPAD_PRO_3GEN_12_9" },
              relationships: { appPreviews: { data: [{ id: "PV", type: "appPreviews" }] } },
            },
          ],
        },
      },
      "/appPreviewSets/SETF/appPreviews?": {
        body: {
          data: [
            { id: "PV", attributes: { previewUrl: "https://x/y.mp4", assetDeliveryState: { state: "COMPLETE" } } },
          ],
        },
      },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1" });
    expect(result.usedLocale).toBe("fr-FR");
    expect(result.devices[0]?.previewType).toBe("APP_IPAD_PRO_3GEN_12_9");
  });

  it("reads appPreviews from included[] without a separate fetch", async () => {
    const { fetchFn, calls } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET1", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SET1",
              attributes: { previewType: "APP_IPHONE_67" },
              relationships: { appPreviews: { data: [{ id: "PREV1", type: "appPreviews" }] } },
            },
          ],
          included: [
            {
              id: "PREV1",
              type: "appPreviews",
              attributes: { previewUrl: "https://inc/v.mp4", assetDeliveryState: { state: "COMPLETE" } },
            },
          ],
        },
      },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(result.devices[0]?.urls).toEqual(["https://inc/v.mp4"]);
    // no separate /appPreviewSets/SET1/appPreviews call was needed
    expect(calls.some((u) => u.includes("/appPreviewSets/SET1/appPreviews"))).toBe(false);
  });

  it("surfaces incomplete/failed asset states and errorMsg per device", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET1", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SET1",
              attributes: { previewType: "APP_IPHONE_67" },
              relationships: { appPreviews: { data: [{ id: "P1", type: "appPreviews" }] } },
            },
          ],
        },
      },
      "/appPreviewSets/SET1/appPreviews?": {
        body: {
          data: [
            {
              id: "P1",
              attributes: {
                assetDeliveryState: { state: "FAILED", errors: [{ code: "PREVIEW_GENERATION_FAILED" }] },
              },
            },
          ],
        },
      },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    const d = result.devices[0]!;
    expect(d.assetState).toEqual(["FAILED"]);
    expect(d.urls).toEqual([]); // no previewUrl yet
    expect(d.errorMsg).toBe("PREVIEW_GENERATION_FAILED");
  });

  it("omits sets that have no preview videos (count 0)", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET_EMPTY", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SET_EMPTY",
              attributes: { previewType: "APP_IPHONE_67" },
              relationships: { appPreviews: { data: [] } },
            },
          ],
        },
      },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(result.devices).toEqual([]);
  });

  it("returns empty devices when the localization has no preview sets", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: { data: [{ id: "LOC1", attributes: { locale: "en-US" } }] },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": { body: { data: [] } },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(result.devices).toEqual([]);
    expect(result.usedLocale).toBe("en-US");
  });

  it("degrades gracefully (empty devices) when appPreviewSets is forbidden (403)", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET1", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": { body: { errors: [] }, status: 403 },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(result.devices).toEqual([]);
  });

  it("throws AscWriteError when the requested locale is absent", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: { data: [{ id: "LDE", attributes: { locale: "de-DE" } }] },
      },
    });

    await expect(
      readAscPreviews(fetchFn, { token: "SECRET_JWT", appId: "APP1", locale: "en-US" }),
    ).rejects.toThrow(AscWriteError);
  });

  it("throws when there are no app store versions", async () => {
    const { fetchFn } = mockFetch({ "/appStoreVersions?": { body: { data: [] } } });
    await expect(readAscPreviews(fetchFn, { token: "JWT", appId: "APP1" })).rejects.toThrow(AscWriteError);
  });

  it("never leaks the token in a thrown error", async () => {
    const { fetchFn } = mockFetch({ "/appStoreVersions?": { body: { errors: [] }, status: 401 } });
    await readAscPreviews(fetchFn, { token: "SECRET_JWT", appId: "APP1" }).catch((e: Error) =>
      expect(e.message).not.toContain("SECRET_JWT"),
    );
  });

  it("supports a plain string assetDeliveryState (older ASC shape)", async () => {
    const { fetchFn } = mockFetch({
      ...VERSIONS,
      "/appStoreVersionLocalizations?": {
        body: {
          data: [
            {
              id: "LOC1",
              attributes: { locale: "en-US" },
              relationships: { appPreviewSets: { data: [{ id: "SET1", type: "appPreviewSets" }] } },
            },
          ],
        },
      },
      "/appStoreVersionLocalizations/LOC1/appPreviewSets?": {
        body: {
          data: [
            {
              id: "SET1",
              attributes: { previewType: "APP_IPHONE_67" },
              relationships: { appPreviews: { data: [{ id: "P1", type: "appPreviews" }] } },
            },
          ],
        },
      },
      "/appPreviewSets/SET1/appPreviews?": {
        body: {
          data: [
            { id: "P1", attributes: { previewUrl: "https://x/v.mp4", assetDeliveryState: "PROCESSING" } },
          ],
        },
      },
    });

    const result = await readAscPreviews(fetchFn, { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(result.devices[0]?.assetState).toEqual(["PROCESSING"]);
  });
});

// A fetch stub that routes by URL substring, recording the calls + auth header so
// we can assert no-write behaviour and that the JWT is sent as Bearer (but never leaked).
function makePricingFetch(opts: {
  iapsStatus?: number;
  iapsBody?: unknown;
  pricingStatus?: number;
  pricingBody?: unknown;
}) {
  const calls: { url: string; method: string; auth: string | undefined }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.authorization });
    if (url.includes("/inAppPurchasesV2")) return json(opts.iapsBody ?? {}, opts.iapsStatus ?? 200);
    if (url.includes("/appPriceSchedule")) return json(opts.pricingBody ?? {}, opts.pricingStatus ?? 200);
    return json({}, 404);
  };
  return { fetchFn, calls };
}

const IAPS_BODY = {
  data: [
    {
      id: "iap1",
      type: "inAppPurchases",
      attributes: {
        name: "Premium Features",
        productId: "com.app.premium",
        inAppPurchaseType: "NON_CONSUMABLE",
        state: "ACTIVE",
      },
    },
    {
      id: "iap2",
      type: "inAppPurchases",
      attributes: {
        name: "Coin Pack",
        productId: "com.app.coins",
        inAppPurchaseType: "CONSUMABLE",
        state: "APPROVED",
      },
    },
  ],
};

const PRICING_BODY = {
  data: {
    type: "appPriceSchedules",
    id: "schedule-123",
    relationships: {
      baseTerritory: { data: { id: "USA", type: "territories" } },
      manualPrices: { data: [{ id: "pp-us", type: "appPrices" }] },
    },
  },
  included: [
    { id: "USA", type: "territories", attributes: { currency: "USD" } },
    {
      id: "pp-us",
      type: "appPricePoints",
      attributes: { customerPrice: "0.99", proceeds: "0.70" },
      relationships: { territory: { data: { id: "USA", type: "territories" } } },
    },
  ],
};

describe("readAscPricingAndIAP — IAPs + pricing with graceful degradation", () => {
  it("returns iaps + pricing for a fully set-up app", async () => {
    const { fetchFn } = makePricingFetch({ iapsBody: IAPS_BODY, pricingBody: PRICING_BODY });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.iaps).toHaveLength(2);
    expect(result.iaps[0]).toEqual({
      id: "iap1",
      name: "Premium Features",
      productId: "com.app.premium",
      state: "ACTIVE",
      inAppPurchaseType: "NON_CONSUMABLE",
    });
    expect(result.iaps[1]?.productId).toBe("com.app.coins");

    expect(result.pricing.baseTerritory).toBe("USA");
    expect(result.pricing.baseTerritoryPrice).toBe(0.99);
    expect(result.pricing.priceTier).toBe("0.99 USD");
    expect(result.notes).toBeUndefined();
  });

  it("never issues a write (only GET requests) and sends the token as Bearer", async () => {
    const { fetchFn, calls } = makePricingFetch({ iapsBody: IAPS_BODY, pricingBody: PRICING_BODY });
    await readAscPricingAndIAP(fetchFn, { token: "SECRET_JWT", appId: "APP1" });

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.auth).toBe("Bearer SECRET_JWT");
    }
  });

  it("degrades gracefully when the IAPs endpoint is 403 Forbidden", async () => {
    const { fetchFn } = makePricingFetch({ iapsStatus: 403, pricingBody: PRICING_BODY });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.iaps).toEqual([]);
    // pricing still resolves
    expect(result.pricing.baseTerritoryPrice).toBe(0.99);
    expect(result.notes).toBeDefined();
    expect(result.notes?.join(" ")).toMatch(/in-app purchase/i);
  });

  it("degrades gracefully when the price schedule is 404 Not Found", async () => {
    const { fetchFn } = makePricingFetch({ iapsBody: IAPS_BODY, pricingStatus: 404 });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.iaps).toHaveLength(2);
    expect(result.pricing.priceTier).toBeNull();
    expect(result.pricing.baseTerritoryPrice).toBeNull();
    expect(result.pricing.baseTerritory).toBeNull();
    expect(result.notes?.join(" ")).toMatch(/price/i);
  });

  it("returns empty-but-valid when BOTH endpoints fail — the run continues", async () => {
    const { fetchFn } = makePricingFetch({ iapsStatus: 403, pricingStatus: 404 });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.iaps).toEqual([]);
    expect(result.pricing).toEqual({ priceTier: null, baseTerritoryPrice: null, baseTerritory: null });
    expect(result.notes).toHaveLength(2);
  });

  it("nulls pricing fields (not undefined) on a sparse schedule with no price points", async () => {
    const sparse = {
      data: { type: "appPriceSchedules", id: "s1", relationships: {} },
    };
    const { fetchFn } = makePricingFetch({ iapsBody: IAPS_BODY, pricingBody: sparse });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.pricing.priceTier).toBeNull();
    expect(result.pricing.baseTerritoryPrice).toBeNull();
    expect(result.pricing.baseTerritory).toBeNull();
  });

  it("keeps all IAPs even when some attributes are missing", async () => {
    const partial = { data: [{ id: "iapX", type: "inAppPurchases", attributes: { productId: "com.app.x" } }] };
    const { fetchFn } = makePricingFetch({ iapsBody: partial, pricingStatus: 404 });
    const result = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    expect(result.iaps).toHaveLength(1);
    expect(result.iaps[0]).toEqual({ id: "iapX", productId: "com.app.x" });
  });

  it("never leaks the token in any note (degradation path)", async () => {
    const { fetchFn } = makePricingFetch({ iapsStatus: 403, pricingStatus: 404 });
    const result = await readAscPricingAndIAP(fetchFn, { token: "SECRET_JWT", appId: "APP1" });
    for (const n of result.notes ?? []) {
      expect(n).not.toContain("SECRET_JWT");
    }
  });

  it("requests inAppPurchasesV2 with a high limit and appPriceSchedule includes", async () => {
    const { fetchFn, calls } = makePricingFetch({ iapsBody: IAPS_BODY, pricingBody: PRICING_BODY });
    await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });

    const iapCall = calls.find((c) => c.url.includes("/inAppPurchasesV2"));
    expect(iapCall?.url).toContain("/apps/APP1/inAppPurchasesV2");
    expect(iapCall?.url).toContain("limit=200");

    const priceCall = calls.find((c) => c.url.includes("/appPriceSchedule"));
    expect(priceCall?.url).toContain("/apps/APP1/appPriceSchedule");
  });

  it("returns a typed AppPricing shape", async () => {
    const { fetchFn } = makePricingFetch({ iapsBody: IAPS_BODY, pricingBody: PRICING_BODY });
    const result: AppPricing = await readAscPricingAndIAP(fetchFn, { token: "JWT", appId: "APP1" });
    expect(Array.isArray(result.iaps)).toBe(true);
    expect(typeof result.pricing).toBe("object");
  });
});
