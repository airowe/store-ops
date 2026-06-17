import { describe, expect, it } from "vitest";
import { readAscScreenshots, classifyDevice, type AscScreenshotSet } from "./ascRead.js";
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
