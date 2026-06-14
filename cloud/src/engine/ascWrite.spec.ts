import { describe, expect, it } from "vitest";
import {
  pickEditableVersion,
  buildLocalizationPatch,
  pickLocalization,
  applyAscMetadata,
  findAscAppId,
  AscWriteError,
  EDITABLE_STATES,
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
});

// ── buildLocalizationPatch: proposedCopy → ASC PATCH body ──
describe("buildLocalizationPatch", () => {
  const copy: CopyFields = {
    name: "Calm — Sleep & Meditation",
    subtitle: "Relax, focus, sleep",
    keywords: "meditation,sleep,calm,focus",
    promo: "New: bedtime stories.",
    description: "The #1 app for sleep and meditation.",
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
  });

  it("omits attributes that are absent in the copy (never sends empty over the real value)", () => {
    const minimal: CopyFields = { name: "X", subtitle: "Y", keywords: "z" };
    const a = buildLocalizationPatch("LOC123", minimal).data.attributes;
    expect(a.name).toBe("X");
    expect("promotionalText" in a).toBe(false);
    expect("description" in a).toBe(false);
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
