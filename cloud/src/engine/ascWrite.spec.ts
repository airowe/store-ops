import { describe, expect, it } from "vitest";
import {
  pickEditableVersion,
  pickReadableVersion,
  buildLocalizationPatch,
  pickLocalization,
  applyAscMetadata,
  readAscLocalization,
  readAscVersionState,
  readAscAppInfo,
  readAscAgeRating,
  readAscCustomProductPages,
  readAscAllLocales,
  findAscAppId,
  AscWriteError,
  EDITABLE_STATES,
  type FetchLike,
} from "./ascWrite.js";
import type { CopyFields } from "./optimize.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ── pickEditableVersion: only an unsubmitted/preparing version is editable ──
describe("pickEditableVersion", () => {
  const ver = (id: string, state: string) => ({ id, attributes: { appStoreState: state } });

  it("returns a version in PREPARE_FOR_SUBMISSION", () => {
    const v = pickEditableVersion([ver("1", "READY_FOR_SALE"), ver("2", "PREPARE_FOR_SUBMISSION")]);
    expect(v.id).toBe("2");
  });

  it("accepts every editable state", () => {
    for (const s of EDITABLE_STATES) {
      expect(pickEditableVersion([ver("x", s)]).id).toBe("x");
    }
  });

  it("throws AscWriteError when no editable version exists", () => {
    expect(() => pickEditableVersion([ver("1", "READY_FOR_SALE"), ver("2", "IN_REVIEW")])).toThrow(
      AscWriteError,
    );
  });

  it("throws on an empty version list", () => {
    expect(() => pickEditableVersion([])).toThrow(AscWriteError);
  });
});

// ── pickLocalization: match the requested locale, else throw ──
describe("pickLocalization", () => {
  const loc = (id: string, locale: string) => ({ id, attributes: { locale } });

  it("matches the exact locale", () => {
    const l = pickLocalization([loc("a", "en-GB"), loc("b", "en-US")], "en-US");
    expect(l.id).toBe("b");
  });

  it("throws when the locale is absent", () => {
    expect(() => pickLocalization([loc("a", "de-DE")], "en-US")).toThrow(AscWriteError);
  });

  it("preserves the live subtitle + keywords attributes on the picked localization", () => {
    const rich = {
      id: "b",
      attributes: { locale: "en-US", subtitle: "Stoic calm for atheists", keywords: "stoic,seneca,aurelius" },
    };
    const l = pickLocalization([rich], "en-US");
    expect(l.attributes?.subtitle).toBe("Stoic calm for atheists");
    expect(l.attributes?.keywords).toBe("stoic,seneca,aurelius");
  });
});

// ── readAscLocalization: pull the CURRENT live copy so we IMPROVE, not replace ──
describe("readAscLocalization — reads live subtitle/keywords (the #30 fix)", () => {
  function mockFetch(routes: Record<string, unknown>): FetchLike {
    return (async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      return {
        ok: true,
        status: 200,
        json: async () => routes[key ?? ""] ?? {},
      } as unknown as Response;
    }) as FetchLike;
  }

  const routes = {
    "/appStoreVersions?": { data: [{ id: "V1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
    "/appStoreVersionLocalizations?": {
      data: [
        {
          id: "L1",
          attributes: {
            locale: "en-US",
            name: "Heathen - Secular Meditation",
            subtitle: "Stoic calm for atheists",
            keywords: "mindfulness,journal,affirmation,anxiety,sleep,focus,philosophy,aurelius,seneca,agnostic,gratitude",
            promotionalText: "New programs.",
            description: "A secular meditation app.",
            whatsNew: "Added offline mode. Fixed a sync crash.",
          },
        },
      ],
    },
  };

  it("returns the live subtitle + keywords (+ name/promo/description) for the editable version's locale", async () => {
    const live = await readAscLocalization(mockFetch(routes), {
      token: "JWT",
      appId: "APP1",
      locale: "en-US",
    });
    expect(live.subtitle).toBe("Stoic calm for atheists");
    expect(live.keywords).toContain("aurelius");
    expect(live.keywords).toContain("agnostic");
    expect(live.name).toBe("Heathen - Secular Meditation");
    expect(live.promo).toBe("New programs.");
    expect(live.description).toBe("A secular meditation app.");
    expect(live.whatsNew).toBe("Added offline mode. Fixed a sync crash."); // release notes (#46)
  });

  it("returns undefined fields when ASC omits them (a sparse listing)", async () => {
    const sparse = {
      "/appStoreVersions?": { data: [{ id: "V1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
      "/appStoreVersionLocalizations?": { data: [{ id: "L1", attributes: { locale: "en-US" } }] },
    };
    const live = await readAscLocalization(mockFetch(sparse), { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(live.subtitle).toBeUndefined();
    expect(live.keywords).toBeUndefined();
  });

  // An app with NO editable (draft) version — only a live, published one. Reading
  // must still work (Apple lets you read published metadata); only WRITING needs a
  // draft. This is the fallback that unblocked the Heathen pass: a live-only app
  // should still get an improvable proposal.
  it("falls back to the live (READY_FOR_SALE) version when there is no editable one", async () => {
    const liveOnly = {
      "/appStoreVersions?": { data: [{ id: "VLIVE", attributes: { appStoreState: "READY_FOR_SALE" } }] },
      "/appStoreVersionLocalizations?": {
        data: [
          {
            id: "LLIVE",
            attributes: { locale: "en-US", subtitle: "Stoic calm for atheists", keywords: "mindfulness,stoic" },
          },
        ],
      },
    };
    const live = await readAscLocalization(mockFetch(liveOnly), { token: "JWT", appId: "APP1", locale: "en-US" });
    expect(live.subtitle).toBe("Stoic calm for atheists");
    expect(live.keywords).toBe("mindfulness,stoic");
  });

  it("throws only when there are NO versions at all", async () => {
    const none = { "/appStoreVersions?": { data: [] } };
    await expect(readAscLocalization(mockFetch(none), { token: "JWT", appId: "APP1", locale: "en-US" })).rejects.toThrow();
  });
});

// ── pickReadableVersion: editable preferred, but ANY version is readable ──
describe("pickReadableVersion", () => {
  const ver = (id: string, s: string) => ({ id, attributes: { appStoreState: s } });

  it("prefers an editable version when one exists", () => {
    const v = pickReadableVersion([ver("LIVE", "READY_FOR_SALE"), ver("DRAFT", "PREPARE_FOR_SUBMISSION")]);
    expect(v.id).toBe("DRAFT");
  });

  it("falls back to the live version when none is editable", () => {
    const v = pickReadableVersion([ver("LIVE", "READY_FOR_SALE")]);
    expect(v.id).toBe("LIVE");
  });

  it("throws only on an empty version list", () => {
    expect(() => pickReadableVersion([])).toThrow(AscWriteError);
  });
});

// ── buildLocalizationPatch: proposedCopy → ASC PATCH body ──
describe("buildLocalizationPatch", () => {
  const copy: CopyFields = {
    name: "Calm — Sleep & Meditation",
    subtitle: "Relax, focus, sleep",
    keywords: "meditation,sleep,calm,focus",
    promo: "New: bedtime stories.",
    description: "The #1 app for sleep and meditation.",
    whatsNew: "Added offline playback. Fixed a sync crash.",
  };

  it("targets the appStoreVersionLocalizations resource with the given id", () => {
    const body = buildLocalizationPatch("LOC123", copy);
    expect(body.data.type).toBe("appStoreVersionLocalizations");
    expect(body.data.id).toBe("LOC123");
  });

  it("maps copy fields to the ASC attribute names", () => {
    const a = buildLocalizationPatch("LOC123", copy).data.attributes;
    expect(a.name).toBe(copy.name);
    expect(a.subtitle).toBe(copy.subtitle);
    expect(a.keywords).toBe(copy.keywords);
    expect(a.promotionalText).toBe(copy.promo); // promo → promotionalText
    expect(a.description).toBe(copy.description);
    expect(a.whatsNew).toBe(copy.whatsNew); // release notes (#46)
  });

  it("omits attributes that are absent in the copy (never sends empty over the real value)", () => {
    const minimal: CopyFields = { name: "X", subtitle: "Y", keywords: "z" };
    const a = buildLocalizationPatch("LOC123", minimal).data.attributes;
    expect(a.name).toBe("X");
    expect("promotionalText" in a).toBe(false);
    expect("description" in a).toBe(false);
    expect("whatsNew" in a).toBe(false); // release notes omitted when absent (#46)
  });

  it("omits empty-string fields too (don't wipe a live field with a blank)", () => {
    const withBlanks: CopyFields = { name: "X", subtitle: "", keywords: "" };
    const a = buildLocalizationPatch("LOC123", withBlanks).data.attributes;
    expect(a.name).toBe("X");
    expect("subtitle" in a).toBe(false);
    expect("keywords" in a).toBe(false);
  });
});

// ── applyAscMetadata: the 3-step orchestration (injected fetch) ──
describe("applyAscMetadata — version → localization → PATCH", () => {
  const copy: CopyFields = {
    name: "Calm",
    subtitle: "Sleep & focus",
    keywords: "meditation,sleep",
    description: "Best sleep app.",
  };

  function makeFetch(opts: {
    versions: { id: string; attributes: { appStoreState: string } }[];
    locales: { id: string; attributes: { locale: string } }[];
    patchStatus?: number;
  }) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      const reqBody = init?.body as string | undefined;
      calls.push(reqBody === undefined ? { url, method: init?.method ?? "GET" } : { url, method: init?.method ?? "GET", body: reqBody });
      if (url.includes("/appStoreVersions?")) return json({ data: opts.versions });
      if (url.includes("/appStoreVersionLocalizations?")) return json({ data: opts.locales });
      if (url.includes("/appStoreVersionLocalizations/")) {
        return json({ data: {} }, opts.patchStatus ?? 200);
      }
      return json({}, 404);
    };
    return { fetchFn, calls };
  }

  it("walks versions → localizations → PATCH and reports pushed fields", async () => {
    const { fetchFn, calls } = makeFetch({
      versions: [
        { id: "V_LIVE", attributes: { appStoreState: "READY_FOR_SALE" } },
        { id: "V_EDIT", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } },
      ],
      locales: [{ id: "L_US", attributes: { locale: "en-US" } }],
    });
    const r = await applyAscMetadata(fetchFn, { token: "JWT", appId: "APP1", copy, locale: "en-US" });
    expect(r.ok).toBe(true);
    expect(r.versionId).toBe("V_EDIT");
    expect(r.localizationId).toBe("L_US");
    expect(r.fieldsPushed).toContain("name");
    // the PATCH was the final call, method PATCH, targeting the localization
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("/appStoreVersionLocalizations/L_US");
    expect(patch?.body).toContain('"name":"Calm"');
  });

  it("throws (no token leak) when no editable version exists", async () => {
    const { fetchFn } = makeFetch({
      versions: [{ id: "V", attributes: { appStoreState: "IN_REVIEW" } }],
      locales: [],
    });
    await expect(
      applyAscMetadata(fetchFn, { token: "SECRET_JWT", appId: "A", copy, locale: "en-US" }),
    ).rejects.toThrow(AscWriteError);
  });

  it("surfaces an ASC PATCH rejection as a token-free error", async () => {
    const { fetchFn } = makeFetch({
      versions: [{ id: "V_EDIT", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }],
      locales: [{ id: "L_US", attributes: { locale: "en-US" } }],
      patchStatus: 409,
    });
    await expect(
      applyAscMetadata(fetchFn, { token: "SECRET_JWT", appId: "A", copy, locale: "en-US" }),
    ).rejects.toThrow(/409/);
    // and the token must never appear in the thrown message
    await applyAscMetadata(fetchFn, { token: "SECRET_JWT", appId: "A", copy, locale: "en-US" }).catch(
      (e: Error) => expect(e.message).not.toContain("SECRET_JWT"),
    );
  });
});

describe("findAscAppId — resolve ASC numeric id from bundle id", () => {
  it("returns the app id for a matching bundle", async () => {
    const fetchFn = async (url: string) => {
      expect(url).toContain("filter[bundleId]=com.acme.app");
      return json({ data: [{ id: "1234567890", type: "apps" }] });
    };
    const id = await findAscAppId(fetchFn, "JWT", "com.acme.app");
    expect(id).toBe("1234567890");
  });

  it("throws when the key's team can't see the bundle", async () => {
    const fetchFn = async () => json({ data: [] });
    await expect(findAscAppId(fetchFn, "JWT", "com.acme.app")).rejects.toThrow(AscWriteError);
  });
});


// ── readAscVersionState: surface version submission state for the audit ──
describe("readAscVersionState — version submission state (no new endpoint)", () => {
  const route = (versions: unknown) =>
    (async (url: string) => {
      if (url.includes("/appStoreVersions?")) {
        return { ok: true, status: 200, json: async () => ({ data: versions }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as FetchLike;

  it("picks the editable (draft) version as `current` even when a live one is present", async () => {
    const fetchFn = route([
      {
        id: "VLIVE",
        attributes: {
          versionString: "2.0.0",
          appStoreState: "READY_FOR_SALE",
          releaseType: "MANUAL",
          createdDate: "2024-01-01T00:00:00Z",
        },
      },
      {
        id: "VDRAFT",
        attributes: {
          versionString: "2.1.0",
          appStoreState: "PREPARE_FOR_SUBMISSION",
          releaseType: "AFTER_APPROVAL",
          createdDate: "2024-06-01T00:00:00Z",
        },
      },
    ]);
    const result = await readAscVersionState(fetchFn, { token: "JWT", appId: "APP1" });
    expect(result.current.id).toBe("VDRAFT");
    expect(result.current.versionString).toBe("2.1.0");
    expect(result.current.appStoreState).toBe("PREPARE_FOR_SUBMISSION");
    expect(result.current.releaseType).toBe("AFTER_APPROVAL");
    expect(result.current.createdDate).toBe("2024-06-01T00:00:00Z");
  });

  it("returns ALL versions in `all`, preserving each version's attributes", async () => {
    const fetchFn = route([
      {
        id: "VLIVE",
        attributes: { versionString: "2.0.0", appStoreState: "READY_FOR_SALE", releaseType: "MANUAL" },
      },
      {
        id: "VDRAFT",
        attributes: { versionString: "2.1.0", appStoreState: "PREPARE_FOR_SUBMISSION" },
      },
    ]);
    const result = await readAscVersionState(fetchFn, { token: "JWT", appId: "APP1" });
    expect(result.all).toHaveLength(2);
    expect(result.all.map((v) => v.id)).toEqual(["VLIVE", "VDRAFT"]);
    expect(result.all[0]?.appStoreState).toBe("READY_FOR_SALE");
    expect(result.all[1]?.versionString).toBe("2.1.0");
  });

  it("handles sparse attributes — optional fields omitted by ASC", async () => {
    const fetchFn = route([
      { id: "V1", attributes: { versionString: "1.0.0", appStoreState: "READY_FOR_SALE" } },
    ]);
    const result = await readAscVersionState(fetchFn, { token: "JWT", appId: "APP1" });
    expect(result.current.versionString).toBe("1.0.0");
    expect(result.current.releaseType).toBeUndefined();
    expect(result.current.createdDate).toBeUndefined();
  });

  it("defaults missing versionString/appStoreState to empty strings", async () => {
    const fetchFn = route([{ id: "V1", attributes: {} }]);
    const result = await readAscVersionState(fetchFn, { token: "JWT", appId: "APP1" });
    expect(result.current.versionString).toBe("");
    expect(result.current.appStoreState).toBe("");
  });

  it("throws AscWriteError when the app has no versions", async () => {
    const fetchFn = route([]);
    await expect(readAscVersionState(fetchFn, { token: "JWT", appId: "APP1" })).rejects.toThrow(AscWriteError);
  });

  it("surfaces a non-OK response via ascError without leaking the token", async () => {
    const fetchFn = (async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ detail: "Authentication credentials are missing or invalid." }] }),
      }) as unknown as Response) as FetchLike;
    const err = await readAscVersionState(fetchFn, { token: "SECRET-JWT", appId: "APP1" }).catch((e) => e);
    expect(err).toBeInstanceOf(AscWriteError);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("SECRET-JWT");
  });
});


// ── readAscAppInfo: the appInfo layer (name/subtitle/privacy + categories) ──
describe("readAscAppInfo — appInfo localizations + categories", () => {
  // A realistic ASC appInfos response with relationships + included resolution.
  const fullAppInfos = {
    data: [
      {
        id: "AI1",
        type: "appInfos",
        attributes: { appStoreState: "READY_FOR_SALE" },
        relationships: {
          appInfoLocalizations: {
            data: [
              { id: "AIL_US", type: "appInfoLocalizations" },
              { id: "AIL_DE", type: "appInfoLocalizations" },
            ],
          },
          primaryCategory: { data: { id: "CAT_HEALTH", type: "appCategories" } },
          secondaryCategory: { data: { id: "CAT_LIFE", type: "appCategories" } },
          ageRatingDeclaration: { data: { id: "AGE1", type: "ageRatingDeclarations" } },
        },
      },
    ],
    included: [
      {
        id: "AIL_US",
        type: "appInfoLocalizations",
        attributes: {
          locale: "en-US",
          name: "Heathen - Secular Meditation",
          subtitle: "Stoic calm for atheists",
          privacyPolicyUrl: "https://example.com/privacy",
          privacyPolicyText: "We collect nothing.",
        },
      },
      {
        id: "AIL_DE",
        type: "appInfoLocalizations",
        attributes: {
          locale: "de-DE",
          name: "Heathen - Säkulare Meditation",
          subtitle: "Stoische Ruhe",
        },
      },
      {
        id: "CAT_HEALTH",
        type: "appCategories",
        attributes: { name: "HEALTH_AND_FITNESS" },
      },
      {
        id: "CAT_LIFE",
        type: "appCategories",
        attributes: { name: "LIFESTYLE" },
      },
      {
        id: "AGE1",
        type: "ageRatingDeclarations",
        attributes: { violenceCartoonOrFantasy: "NONE", gamblingSimulated: "NONE" },
      },
    ],
  };

  function mockFetch(routes: Record<string, { body: unknown; status?: number }>): FetchLike {
    return (async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      const route = routes[key ?? ""];
      const status = route?.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => route?.body ?? {},
      } as unknown as Response;
    }) as FetchLike;
  }

  it("returns every locale's name/subtitle/privacy + resolves both categories from included", async () => {
    const fetchFn = mockFetch({ "/appInfos": { body: fullAppInfos } });
    const r = await readAscAppInfo(fetchFn, { token: "JWT", appId: "APP1" });

    expect(r.locales).toHaveLength(2);
    const us = r.locales.find((l) => l.locale === "en-US");
    expect(us?.name).toBe("Heathen - Secular Meditation");
    expect(us?.subtitle).toBe("Stoic calm for atheists");
    expect(us?.privacyPolicyUrl).toBe("https://example.com/privacy");
    expect(us?.privacyPolicyText).toBe("We collect nothing.");

    const de = r.locales.find((l) => l.locale === "de-DE");
    expect(de?.name).toBe("Heathen - Säkulare Meditation");
    expect(de?.privacyPolicyUrl).toBeUndefined();

    expect(r.primaryCategory).toEqual({ id: "CAT_HEALTH", name: "HEALTH_AND_FITNESS" });
    expect(r.secondaryCategory).toEqual({ id: "CAT_LIFE", name: "LIFESTYLE" });
    expect(r.ageRatingDeclaration?.id).toBe("AGE1");
    expect(r.ageRatingDeclaration?.attributes?.violenceCartoonOrFantasy).toBe("NONE");
  });

  it("hits GET /apps/{appId}/appInfos with an include for graceful resolution", async () => {
    let seen = "";
    const fetchFn = (async (url: string) => {
      seen = url;
      return { ok: true, status: 200, json: async () => fullAppInfos } as unknown as Response;
    }) as FetchLike;
    await readAscAppInfo(fetchFn, { token: "JWT", appId: "APP_XYZ" });
    expect(seen).toContain("/apps/APP_XYZ/appInfos");
  });

  it("degrades gracefully: category id present but not in included → id only, no name, no throw", async () => {
    const sparseIncluded = {
      data: [
        {
          id: "AI1",
          type: "appInfos",
          relationships: {
            appInfoLocalizations: { data: [{ id: "AIL_US", type: "appInfoLocalizations" }] },
            primaryCategory: { data: { id: "CAT_HEALTH", type: "appCategories" } },
          },
        },
      ],
      included: [
        {
          id: "AIL_US",
          type: "appInfoLocalizations",
          attributes: { locale: "en-US", name: "App" },
        },
      ],
    };
    const fetchFn = mockFetch({ "/appInfos": { body: sparseIncluded } });
    const r = await readAscAppInfo(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.primaryCategory).toEqual({ id: "CAT_HEALTH" });
    expect(r.secondaryCategory).toBeUndefined();
    expect(r.locales).toHaveLength(1);
    expect(r.locales[0]?.name).toBe("App");
  });

  it("returns empty locales (no throw) when appInfos data is empty", async () => {
    const fetchFn = mockFetch({ "/appInfos": { body: { data: [] } } });
    const r = await readAscAppInfo(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.locales).toEqual([]);
    expect(r.primaryCategory).toBeUndefined();
  });

  it("returns empty locales when the localizations relationship is missing/empty", async () => {
    const noLocs = {
      data: [{ id: "AI1", type: "appInfos", relationships: {} }],
      included: [],
    };
    const fetchFn = mockFetch({ "/appInfos": { body: noLocs } });
    const r = await readAscAppInfo(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.locales).toEqual([]);
  });

  it("throws a token-free AscWriteError on a non-OK appInfos fetch", async () => {
    const fetchFn = mockFetch({
      "/appInfos": { body: { errors: [{ detail: "Forbidden" }] }, status: 403 },
    });
    await expect(readAscAppInfo(fetchFn, { token: "SECRET_JWT", appId: "APP1" })).rejects.toThrow(
      AscWriteError,
    );
    await readAscAppInfo(fetchFn, { token: "SECRET_JWT", appId: "APP1" }).catch((e: Error) => {
      expect(e.message).toContain("403");
      expect(e.message).not.toContain("SECRET_JWT");
    });
  });
});

// ── readAscAgeRating: read declared age rating + content descriptors ──────────
describe("readAscAgeRating — appInfo → ageRatingDeclaration", () => {
  // A fetch mock keyed by URL substring; tracks whether the fallback GET fired.
  function makeFetch(routes: { match: string; body: unknown; status?: number }[]) {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      const route = routes.find((r) => url.includes(r.match));
      if (!route) return json({}, 404);
      return json(route.body, route.status ?? 200);
    }) as FetchLike;
    return { fetchFn, calls };
  }

  const declarationAttributes = {
    ageRatingOverride: "NONE",
    kidsAgeBand: null,
    // the derived rating Apple computes from the declaration answers
    ageRating: "TWELVE_PLUS",
    kindOfAgeRating: "PEGI",
    // content descriptor questions that came back set
    violenceCartoonOrFantasy: "INFREQUENT_OR_MILD",
    alcoholTobaccoOrDrugUseOrReferences: "FREQUENT_OR_INTENSE",
    gambling: false,
    horrorOrFearThemes: "NONE",
  };

  it("returns the rating + descriptors when the declaration is in the included array", async () => {
    const { fetchFn, calls } = makeFetch([
      {
        match: "/appInfos?",
        body: {
          data: [
            {
              id: "INFO1",
              type: "appInfos",
              relationships: {
                ageRatingDeclaration: { data: { id: "DECL1", type: "ageRatingDeclarations" } },
              },
            },
          ],
          included: [
            { id: "DECL1", type: "ageRatingDeclarations", attributes: declarationAttributes },
          ],
        },
      },
    ]);
    const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.ageRating).toBe("TWELVE_PLUS");
    expect(r.kindOfAgeRating).toBe("PEGI");
    // descriptors are the non-NONE / truthy declaration keys
    expect(r.contentDescriptors).toContain("violenceCartoonOrFantasy");
    expect(r.contentDescriptors).toContain("alcoholTobaccoOrDrugUseOrReferences");
    expect(r.contentDescriptors).not.toContain("horrorOrFearThemes"); // NONE → excluded
    expect(r.contentDescriptors).not.toContain("gambling"); // false → excluded
    // no fallback GET needed when included is present
    expect(calls.some((u) => u.includes("/ageRatingDeclarations/"))).toBe(false);
  });

  it("falls back to GET /ageRatingDeclarations/{id} when not in included", async () => {
    const { fetchFn, calls } = makeFetch([
      {
        match: "/appInfos?",
        body: {
          data: [
            {
              id: "INFO1",
              type: "appInfos",
              relationships: {
                ageRatingDeclaration: { data: { id: "DECL1", type: "ageRatingDeclarations" } },
              },
            },
          ],
        },
      },
      {
        match: "/ageRatingDeclarations/DECL1",
        body: { data: { id: "DECL1", type: "ageRatingDeclarations", attributes: declarationAttributes } },
      },
    ]);
    const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.ageRating).toBe("TWELVE_PLUS");
    expect(calls.some((u) => u.includes("/ageRatingDeclarations/DECL1"))).toBe(true);
  });

  it("degrades to an empty result when there are no appInfos", async () => {
    const { fetchFn } = makeFetch([{ match: "/appInfos?", body: { data: [] } }]);
    const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r).toEqual({});
  });

  it("degrades to an empty result when the appInfo has no ageRatingDeclaration relationship", async () => {
    const { fetchFn, calls } = makeFetch([
      { match: "/appInfos?", body: { data: [{ id: "INFO1", type: "appInfos", relationships: {} }] } },
    ]);
    const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r).toEqual({});
    // never attempts the declaration fetch
    expect(calls.some((u) => u.includes("/ageRatingDeclarations/"))).toBe(false);
  });

  it("degrades to an empty result when the fallback declaration GET 404s", async () => {
    const { fetchFn } = makeFetch([
      {
        match: "/appInfos?",
        body: {
          data: [
            {
              id: "INFO1",
              type: "appInfos",
              relationships: { ageRatingDeclaration: { data: { id: "DECL1", type: "ageRatingDeclarations" } } },
            },
          ],
        },
      },
      { match: "/ageRatingDeclarations/DECL1", body: { errors: [{ detail: "not found" }] }, status: 404 },
    ]);
    const r = await readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r).toEqual({});
  });

  it("throws a token-free AscWriteError on an auth failure (401)", async () => {
    const { fetchFn } = makeFetch([
      { match: "/appInfos?", body: { errors: [{ detail: "NOT_AUTHORIZED" }] }, status: 401 },
    ]);
    await expect(readAscAgeRating(fetchFn, { token: "SECRET_JWT", appId: "APP1" })).rejects.toThrow(
      AscWriteError,
    );
    await readAscAgeRating(fetchFn, { token: "SECRET_JWT", appId: "APP1" }).catch((e: Error) => {
      expect(e.message).toContain("401");
      expect(e.message).not.toContain("SECRET_JWT");
    });
  });

  it("throws on a 403 forbidden (insufficient permission)", async () => {
    const { fetchFn } = makeFetch([{ match: "/appInfos?", body: {}, status: 403 }]);
    await expect(readAscAgeRating(fetchFn, { token: "JWT", appId: "APP1" })).rejects.toThrow(AscWriteError);
  });
});

// ── readAscCustomProductPages: the PPO surface (app-level, no version/locale) ──
describe("readAscCustomProductPages — list custom product pages (PPO)", () => {
  it("maps data[].attributes to {id,name,state} and queries the right endpoint", async () => {
    let seenUrl = "";
    const fetchFn = async (url: string) => {
      seenUrl = url;
      return json({
        data: [
          { id: "PPO1", type: "appCustomProductPages", attributes: { name: "Sleep Stories", state: "PREPARE_FOR_SUBMISSION" } },
          { id: "PPO2", type: "appCustomProductPages", attributes: { name: "Focus Music", state: "READY_FOR_SALE" } },
        ],
      });
    };
    const r = await readAscCustomProductPages(fetchFn, { token: "JWT", appId: "APP1" });
    expect(seenUrl).toContain("/apps/APP1/appCustomProductPages");
    expect(r.pages).toEqual([
      { id: "PPO1", name: "Sleep Stories", state: "PREPARE_FOR_SUBMISSION" },
      { id: "PPO2", name: "Focus Music", state: "READY_FOR_SALE" },
    ]);
  });

  it("returns sparse pages when ASC omits name/state attributes", async () => {
    const fetchFn = async () =>
      json({ data: [{ id: "PPO1", type: "appCustomProductPages", attributes: {} }] });
    const r = await readAscCustomProductPages(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.pages).toEqual([{ id: "PPO1", name: undefined, state: undefined }]);
  });

  it("degrades gracefully to an empty list when the app has no PPO pages", async () => {
    const fetchFn = async () => json({ data: [] });
    const r = await readAscCustomProductPages(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.pages).toEqual([]);
  });

  it("degrades gracefully to an empty list when data is missing entirely", async () => {
    const fetchFn = async () => json({});
    const r = await readAscCustomProductPages(fetchFn, { token: "JWT", appId: "APP1" });
    expect(r.pages).toEqual([]);
  });

  it("surfaces a non-OK ASC response as a token-free AscWriteError", async () => {
    const fetchFn = async () => json({ errors: [{ detail: "Forbidden" }] }, 403);
    await expect(
      readAscCustomProductPages(fetchFn, { token: "SECRET_JWT", appId: "APP1" }),
    ).rejects.toThrow(AscWriteError);
    await readAscCustomProductPages(fetchFn, { token: "SECRET_JWT", appId: "APP1" }).catch(
      (e: Error) => expect(e.message).not.toContain("SECRET_JWT"),
    );
  });
});

// ── readAscAllLocales: every locale on the readable version, not just one ──
describe("readAscAllLocales — all appStoreVersionLocalizations in one read", () => {
  function mockFetch(routes: Record<string, unknown>): FetchLike {
    return (async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      return {
        ok: true,
        status: 200,
        json: async () => routes[key ?? ""] ?? {},
      } as unknown as Response;
    }) as FetchLike;
  }

  const multiLocale = {
    "/appStoreVersions?": { data: [{ id: "V1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
    "/appStoreVersionLocalizations?": {
      data: [
        {
          id: "L1",
          attributes: {
            locale: "en-US",
            name: "Heathen",
            subtitle: "Stoic calm for atheists",
            keywords: "stoic,seneca,aurelius",
            promotionalText: "New programs.",
            description: "A secular meditation app.",
          },
        },
        {
          id: "L2",
          attributes: {
            locale: "de-DE",
            name: "Heathen DE",
            subtitle: "Stoische Ruhe",
            keywords: "stoik,seneca",
            promotionalText: "Neue Programme.",
            description: "Eine säkulare Meditations-App.",
          },
        },
        {
          // sparse locale: only name + locale, everything else omitted by ASC
          id: "L3",
          attributes: { locale: "ja-JP", name: "Heathen JP" },
        },
      ],
    },
  };

  it("returns a flat array of every locale with mapped fields (promotionalText → promo)", async () => {
    const all = await readAscAllLocales(mockFetch(multiLocale), { token: "JWT", appId: "APP1" });
    expect(all).toHaveLength(3);
    expect(all.map((l) => l.locale)).toEqual(["en-US", "de-DE", "ja-JP"]);

    const en = all.find((l) => l.locale === "en-US")!;
    expect(en.name).toBe("Heathen");
    expect(en.subtitle).toBe("Stoic calm for atheists");
    expect(en.keywords).toBe("stoic,seneca,aurelius");
    expect(en.promo).toBe("New programs."); // promotionalText → promo
    expect(en.description).toBe("A secular meditation app.");

    const de = all.find((l) => l.locale === "de-DE")!;
    expect(de.promo).toBe("Neue Programme.");
    expect(de.subtitle).toBe("Stoische Ruhe");
  });

  it("leaves missing fields undefined on a sparse locale (apps vary)", async () => {
    const all = await readAscAllLocales(mockFetch(multiLocale), { token: "JWT", appId: "APP1" });
    const ja = all.find((l) => l.locale === "ja-JP")!;
    expect(ja.name).toBe("Heathen JP");
    expect(ja.subtitle).toBeUndefined();
    expect(ja.keywords).toBeUndefined();
    expect(ja.promo).toBeUndefined();
    expect(ja.description).toBeUndefined();
  });

  it("skips localizations missing a locale (a locale is the result key)", async () => {
    const withGhost = {
      "/appStoreVersions?": { data: [{ id: "V1", attributes: { appStoreState: "READY_FOR_SALE" } }] },
      "/appStoreVersionLocalizations?": {
        data: [
          { id: "L1", attributes: { locale: "en-US", name: "Real" } },
          { id: "LX", attributes: { name: "No locale" } },
        ],
      },
    };
    const all = await readAscAllLocales(mockFetch(withGhost), { token: "JWT", appId: "APP1" });
    expect(all).toHaveLength(1);
    expect(all[0]?.locale).toBe("en-US");
  });

  it("reads from the live version when there is no editable one", async () => {
    const liveOnly = {
      "/appStoreVersions?": { data: [{ id: "VLIVE", attributes: { appStoreState: "READY_FOR_SALE" } }] },
      "/appStoreVersionLocalizations?": {
        data: [{ id: "LLIVE", attributes: { locale: "en-US", subtitle: "live" } }],
      },
    };
    const all = await readAscAllLocales(mockFetch(liveOnly), { token: "JWT", appId: "APP1" });
    expect(all).toHaveLength(1);
    expect(all[0]?.subtitle).toBe("live");
  });

  it("returns an empty array when the readable version has no localizations", async () => {
    const noLocs = {
      "/appStoreVersions?": { data: [{ id: "V1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
      "/appStoreVersionLocalizations?": { data: [] },
    };
    const all = await readAscAllLocales(mockFetch(noLocs), { token: "JWT", appId: "APP1" });
    expect(all).toEqual([]);
  });

  it("throws only when there are NO versions at all", async () => {
    const none = { "/appStoreVersions?": { data: [] } };
    await expect(readAscAllLocales(mockFetch(none), { token: "JWT", appId: "APP1" })).rejects.toThrow(
      AscWriteError,
    );
  });

  it("surfaces a non-OK response as a token-free AscWriteError", async () => {
    const failing: FetchLike = (async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ detail: "Unauthorized" }] }),
      }) as unknown as Response) as FetchLike;
    await expect(
      readAscAllLocales(failing, { token: "SECRET_JWT", appId: "APP1" }),
    ).rejects.toThrow(/401/);
    await readAscAllLocales(failing, { token: "SECRET_JWT", appId: "APP1" }).catch((e: Error) =>
      expect(e.message).not.toContain("SECRET_JWT"),
    );
  });
});
