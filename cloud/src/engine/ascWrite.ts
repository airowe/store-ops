import type { CopyFields } from "./optimize.js";

/**
 * Pure builders for the App Store Connect metadata write (issue #11).
 *
 * The ASC metadata write is a stateful graph, not one call:
 *   1. find the EDITABLE app store version (you can't patch a live/in-review one)
 *   2. find the localization for the target locale
 *   3. PATCH that localization's attributes from the approved copy
 *
 * These functions are the deterministic core (version/localization selection +
 * PATCH body construction); the HTTP orchestration is thin glue around them. The
 * `.p8` and JWT never appear here — auth is handled by the caller via mintAscJwt.
 */

export class AscWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AscWriteError";
  }
}

/** App store version states whose metadata is still editable via the API. */
export const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
] as const;

type Version = {
  id: string;
  attributes?: {
    appStoreState?: string;
    // Version-level metadata exposed by readAscVersionState. Present in the SAME
    // appStoreVersions response the write path already fetches — no new endpoint.
    versionString?: string;
    releaseType?: string;
    createdDate?: string;
  };
};
type Localization = {
  id: string;
  attributes?: {
    locale?: string;
    // The live editable values — present in the SAME response the write path
    // already fetches. We read them so the optimizer can IMPROVE, not replace.
    name?: string;
    subtitle?: string;
    keywords?: string;
    promotionalText?: string;
    description?: string;
    whatsNew?: string; // release notes — present in the SAME localization read (#46)
  };
};

/** The current live copy read back from App Store Connect, shaped like CopyFields. */
export type LiveListingCopy = {
  name?: string | undefined;
  subtitle?: string | undefined;
  keywords?: string | undefined;
  promo?: string | undefined;
  description?: string | undefined;
  whatsNew?: string | undefined; // release notes (#46)
};

/**
 * Version-level submission metadata for a single App Store version. Every field
 * beyond id is optional in spirit — ASC omits some on certain versions — but
 * versionString/appStoreState are normalised to "" so the audit never reads
 * `undefined`. createdDate/releaseType stay optional (apps vary).
 */
export type VersionState = {
  id: string;
  versionString: string;
  appStoreState: string;
  releaseType?: string | undefined;
  createdDate?: string | undefined;
};

/** Result of readAscVersionState: the readable version plus every version seen. */
export type AscVersionStateResult = {
  current: VersionState;
  all: VersionState[];
};

/** Pick the version we're allowed to edit. Throws if none is in an editable state. */
export function pickEditableVersion(versions: Version[]): Version {
  const editable = versions.find(
    (v) => v.attributes?.appStoreState && (EDITABLE_STATES as readonly string[]).includes(v.attributes.appStoreState),
  );
  if (!editable) {
    throw new AscWriteError(
      "No editable App Store version found. Create a new version in App Store Connect " +
        "(state PREPARE_FOR_SUBMISSION) before pushing metadata.",
    );
  }
  return editable;
}

/**
 * Pick a version to READ metadata from. Prefers an editable (draft) version, but
 * falls back to ANY version — including a live READY_FOR_SALE one — because Apple
 * lets you read published metadata even with no draft in progress. Only WRITING
 * needs an editable version; reading should never be blocked by its absence.
 * Throws only when the app has no versions at all.
 */
export function pickReadableVersion(versions: Version[]): Version {
  const editable = versions.find(
    (v) => v.attributes?.appStoreState && (EDITABLE_STATES as readonly string[]).includes(v.attributes.appStoreState),
  );
  if (editable) return editable;
  const any = versions[0];
  if (!any) {
    throw new AscWriteError("No App Store version found for this app.");
  }
  return any;
}

/** Pick the localization matching the locale. Throws if absent. */
export function pickLocalization(localizations: Localization[], locale: string): Localization {
  const match = localizations.find((l) => l.attributes?.locale === locale);
  if (!match) {
    throw new AscWriteError(
      `No "${locale}" localization on the editable version. Add it in App Store Connect first.`,
    );
  }
  return match;
}

export type LocalizationPatch = {
  data: {
    type: "appStoreVersionLocalizations";
    id: string;
    attributes: Partial<{
      name: string;
      subtitle: string;
      keywords: string;
      promotionalText: string;
      description: string;
      whatsNew: string;
    }>;
  };
};

/**
 * Build the PATCH body for an appStoreVersionLocalization from the proposed copy.
 *
 * SAFETY: only non-empty fields are included. A thin proposal (empty subtitle /
 * keywords) must NOT overwrite the user's existing live metadata with blanks —
 * an omitted attribute is left untouched by ASC; an empty string would wipe it.
 */
export function buildLocalizationPatch(localizationId: string, copy: CopyFields): LocalizationPatch {
  const attributes: LocalizationPatch["data"]["attributes"] = {};
  const set = (key: keyof LocalizationPatch["data"]["attributes"], value: string | undefined) => {
    if (value !== undefined && value.trim() !== "") attributes[key] = value;
  };
  set("name", copy.name);
  set("subtitle", copy.subtitle);
  set("keywords", copy.keywords);
  set("promotionalText", copy.promo); // copy.promo → ASC promotionalText
  set("description", copy.description);
  set("whatsNew", copy.whatsNew); // release notes (#46)
  return {
    data: { type: "appStoreVersionLocalizations", id: localizationId, attributes },
  };
}

// ── HTTP orchestration (thin glue over the pure builders above) ──────────────

export const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ApplyAscResult = {
  ok: true;
  versionId: string;
  localizationId: string;
  /** which attributes were actually patched */
  fieldsPushed: string[];
};

/**
 * Apply the approved copy to an app's editable App Store version localization.
 *
 * Steps: list versions → pick the editable one → list its localizations → pick
 * the locale → PATCH it. Auth is the caller's short-lived ASC JWT (Bearer). The
 * JWT is the only credential touched here; the `.p8` never reaches this module.
 *
 * Throws AscWriteError with a user-actionable message on any step failure; the
 * error text never contains the token.
 */
/** Resolve the ASC numeric app id from a bundle id (ASC keys apps by Apple id,
 *  not bundle id). Throws if the credential can't see an app with that bundle. */
export async function findAscAppId(
  fetchFn: FetchLike,
  token: string,
  bundleId: string,
): Promise<string> {
  const res = await fetchFn(
    `${ASC_BASE}/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw await ascError(res, "look up the app by bundle id");
  const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
  const id = body.data?.[0]?.id;
  if (!id) {
    throw new AscWriteError(
      `No App Store Connect app found for bundle id "${bundleId}" with this key. ` +
        "Check that the key's team owns the app.",
    );
  }
  return id;
}

export async function applyAscMetadata(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; copy: CopyFields; locale: string },
): Promise<ApplyAscResult> {
  const auth = { authorization: `Bearer ${opts.token}` };

  // 1. versions for the app
  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Version[] };
  const version = pickEditableVersion(versions.data ?? []);

  // 2. localizations for the editable version
  const locsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,
    { headers: auth },
  );
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locs = (await locsRes.json().catch(() => ({}))) as { data?: Localization[] };
  const localization = pickLocalization(locs.data ?? [], opts.locale);

  // 3. PATCH the localization
  const patch = buildLocalizationPatch(localization.id, opts.copy);
  if (Object.keys(patch.data.attributes).length === 0) {
    throw new AscWriteError("Nothing to push — the proposed copy has no non-empty fields.");
  }
  const patchRes = await fetchFn(`${ASC_BASE}/appStoreVersionLocalizations/${localization.id}`, {
    method: "PATCH",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) throw await ascError(patchRes, "update localization");

  return {
    ok: true,
    versionId: version.id,
    localizationId: localization.id,
    fieldsPushed: Object.keys(patch.data.attributes),
  };
}

/**
 * Read the CURRENT live copy from App Store Connect for the editable version's
 * locale — the #30 fix. ShipASO can't see subtitle/keywords via the public iTunes
 * API, so without this it generated them blind and could regress a good listing.
 * This pulls them from the same version → localization read the write path does,
 * so the optimizer can treat the live values as a baseline to IMPROVE.
 */
export async function readAscLocalization(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; locale: string },
): Promise<LiveListingCopy> {
  const auth = { authorization: `Bearer ${opts.token}` };

  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Version[] };
  // Reading is allowed on a live version — only writing needs an editable one.
  const version = pickReadableVersion(versions.data ?? []);

  const locsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,
    { headers: auth },
  );
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locs = (await locsRes.json().catch(() => ({}))) as { data?: Localization[] };
  const localization = pickLocalization(locs.data ?? [], opts.locale);

  const a = localization.attributes ?? {};

  // #69: name + subtitle DON'T live on the version localization — App Store
  // Connect keeps them on appInfoLocalizations (the app-level layer). Reading
  // them off `a` here always yielded undefined, so a populated subtitle read as
  // empty and the name read stale. Pull them from the appInfo layer for the same
  // locale. Best-effort: an appInfo read failure must NOT strand the copy read
  // (the version-level fields are still valuable), so we degrade to undefined.
  let appInfoName: string | undefined;
  let appInfoSubtitle: string | undefined;
  try {
    const info = await readAscAppInfo(fetchFn, { token: opts.token, appId: opts.appId });
    const loc =
      info.locales.find((l) => l.locale === opts.locale) ??
      // Fall back to a base-language match (e.g. "en" for "en-US") then the first.
      info.locales.find((l) => l.locale.split("-")[0] === opts.locale.split("-")[0]) ??
      info.locales[0];
    appInfoName = loc?.name;
    appInfoSubtitle = loc?.subtitle;
  } catch {
    // appInfo unreadable (restricted key, etc.) — leave name/subtitle unknown
    // rather than asserting an empty value we didn't actually read.
    appInfoName = undefined;
    appInfoSubtitle = undefined;
  }

  // map ASC attribute names → our CopyFields shape (promotionalText → promo).
  // name/subtitle come from the appInfo layer (#69); the rest from the version.
  return {
    name: appInfoName,
    subtitle: appInfoSubtitle,
    keywords: a.keywords,
    promo: a.promotionalText,
    description: a.description,
    whatsNew: a.whatsNew, // release notes (#46)
  };
}


/**
 * Read version submission state from App Store Connect so the audit can stop
 * guessing whether a listing is live, in review, or a draft. Uses the SAME
 * appStoreVersions endpoint the write path already calls — no new endpoint or
 * credential scope — and exposes versionString / appStoreState / releaseType /
 * createdDate for the readable (draft-preferred) version plus every version seen.
 *
 * READ-ONLY. Auth is the caller's short-lived ASC JWT (Bearer); the token never
 * appears in the result or in any thrown error (ascError strips it).
 */
export async function readAscVersionState(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AscVersionStateResult> {
  const auth = { authorization: `Bearer ${opts.token}` };

  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Version[] };
  const data = versions.data ?? [];

  const toState = (v: Version): VersionState => {
    const a = v.attributes ?? {};
    return {
      id: v.id,
      versionString: a.versionString ?? "",
      appStoreState: a.appStoreState ?? "",
      releaseType: a.releaseType,
      createdDate: a.createdDate,
    };
  };

  // Throws AscWriteError when there are no versions at all.
  const current = toState(pickReadableVersion(data));
  return { current, all: data.map(toState) };
}


// ── readAscAppInfo: the appInfo layer (distinct from the version layer) ──────
//
// App Store Connect splits listing metadata across TWO layers:
//   - appStoreVersion → appStoreVersionLocalization (name/subtitle/keywords/…)
//   - app → appInfo → appInfoLocalization (name/subtitle/privacyPolicy…) AND the
//     app's primary/secondary category + age-rating declaration.
// readAscLocalization above covers the version layer; this covers the appInfo
// layer. Apps differ in which fields they populate, so every field is optional.

/** A generic JSON:API resource as ASC returns it (data[] / included[]). */
type JsonApiResource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] }>;
};

/** Clean, typed result of the appInfo layer read. All fields optional (apps vary). */
export type AppInfoResult = {
  locales: Array<{
    locale: string;
    name?: string | undefined;
    subtitle?: string | undefined;
    privacyPolicyUrl?: string | undefined;
    privacyPolicyText?: string | undefined;
  }>;
  primaryCategory?: { id: string; name?: string | undefined } | undefined;
  secondaryCategory?: { id: string; name?: string | undefined } | undefined;
  ageRatingDeclaration?: { id: string; attributes?: Record<string, unknown> | undefined } | undefined;
};

/** Index included[] by `${type}:${id}` for O(1) relationship resolution. */
function indexIncluded(included: JsonApiResource[]): Map<string, JsonApiResource> {
  const map = new Map<string, JsonApiResource>();
  for (const r of included) {
    if (r && typeof r.id === "string" && typeof r.type === "string") map.set(`${r.type}:${r.id}`, r);
  }
  return map;
}

/** Resolve a to-one relationship stub to its included resource (or just the id stub). */
function resolveToOne(
  rel: { data?: { id: string; type: string } | { id: string; type: string }[] } | undefined,
  included: Map<string, JsonApiResource>,
): JsonApiResource | { id: string; type: string } | undefined {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return undefined;
  return included.get(`${data.type}:${data.id}`) ?? data;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Read the appInfo layer for an app: per-locale name/subtitle/privacy policy plus
 * the resolved primary/secondary category and (when readable) the age-rating
 * declaration. ASC returns appInfoLocalizations and categories in `included[]`
 * when we ask for them via `?include=`, so this is normally a single GET.
 *
 * Degrades gracefully: an empty app, a missing localizations relationship, or a
 * category id that isn't expanded in `included[]` all yield a partial result
 * rather than an error. Only a non-OK HTTP response throws — as a token-free
 * AscWriteError. The JWT is never logged or returned.
 */
export async function readAscAppInfo(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AppInfoResult> {
  const auth = { authorization: `Bearer ${opts.token}` };

  // One GET, asking ASC to expand the relationships we map into `included[]`.
  const include = "appInfoLocalizations,primaryCategory,secondaryCategory,ageRatingDeclaration";
  const res = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appInfos?limit=50&include=${include}`,
    { headers: auth },
  );
  if (!res.ok) throw await ascError(res, "list app infos");

  const body = (await res.json().catch(() => ({}))) as {
    data?: JsonApiResource[];
    included?: JsonApiResource[];
  };

  const appInfo = body.data?.[0];
  const empty: AppInfoResult = { locales: [] };
  if (!appInfo) return empty;

  const included = indexIncluded(body.included ?? []);
  const rels = appInfo.relationships ?? {};

  // Localizations: each relationship stub → the appInfoLocalization in included.
  const locRel = rels.appInfoLocalizations?.data;
  const locStubs = Array.isArray(locRel) ? locRel : locRel ? [locRel] : [];
  const locales: AppInfoResult["locales"] = [];
  for (const stub of locStubs) {
    const resource = included.get(`${stub.type}:${stub.id}`);
    const a = resource?.attributes ?? {};
    const locale = asString(a.locale);
    if (!locale) continue; // a localization with no locale is unusable
    locales.push({
      locale,
      name: asString(a.name),
      subtitle: asString(a.subtitle),
      privacyPolicyUrl: asString(a.privacyPolicyUrl),
      privacyPolicyText: asString(a.privacyPolicyText),
    });
  }

  const result: AppInfoResult = { locales };

  // Categories: resolve to a {id,name} when expanded; fall back to id-only.
  const toCategory = (
    rel: JsonApiResource | { id: string; type: string } | undefined,
  ): { id: string; name?: string } | undefined => {
    if (!rel) return undefined;
    const name = "attributes" in rel ? asString(rel.attributes?.name) : undefined;
    return name ? { id: rel.id, name } : { id: rel.id };
  };
  const primary = toCategory(resolveToOne(rels.primaryCategory, included));
  if (primary) result.primaryCategory = primary;
  const secondary = toCategory(resolveToOne(rels.secondaryCategory, included));
  if (secondary) result.secondaryCategory = secondary;

  // Age rating: surface id + raw attributes when the key can read it.
  const age = resolveToOne(rels.ageRatingDeclaration, included);
  if (age) {
    const attributes = "attributes" in age ? age.attributes : undefined;
    result.ageRatingDeclaration = attributes ? { id: age.id, attributes } : { id: age.id };
  }

  return result;
}


/** The declared age rating + content descriptors read off the appInfo's
 *  ageRatingDeclaration. Every field is optional — many apps never set this,
 *  and Apple's schema evolves, so we degrade gracefully on anything missing. */
export type AscAgeRatingResult = {
  /** Apple's derived rating bucket, when present. */
  ageRating?: "FOUR_PLUS" | "TWELVE_PLUS" | "SEVENTEEN_PLUS" | "EIGHTEEN_PLUS" | undefined;
  /** Names of the declaration questions that came back set (non-NONE / truthy),
   *  e.g. ["alcoholTobaccoOrDrugUseOrReferences", "violenceCartoonOrFantasy"]. */
  contentDescriptors?: string[] | undefined;
  /** Rating system label when surfaced (e.g. "PEGI", "ESRB", "CLASSIND"). */
  kindOfAgeRating?: string | undefined;
};

type Relationship = { data?: { id?: string; type?: string } | null };
type AgeRatingDeclaration = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
};
type AppInfo = {
  id?: string;
  type?: string;
  relationships?: { ageRatingDeclaration?: Relationship };
};

/** A declared-rating bucket if Apple's value is one we recognise, else undefined. */
function normalizeAgeRating(value: unknown): AscAgeRatingResult["ageRating"] {
  return value === "FOUR_PLUS" ||
    value === "TWELVE_PLUS" ||
    value === "SEVENTEEN_PLUS" ||
    value === "EIGHTEEN_PLUS"
    ? value
    : undefined;
}

/** Keys that carry the rating itself, not a content-descriptor question. */
const AGE_RATING_META_KEYS = new Set([
  "ageRating",
  "kindOfAgeRating",
  "ageRatingOverride",
  "kidsAgeBand",
]);

/**
 * Map an ageRatingDeclaration's attributes into a clean result. Content
 * descriptors are the declaration questions that came back "set": a string other
 * than "NONE" (e.g. "INFREQUENT_OR_MILD") or a truthy boolean. Meta keys (the
 * rating, the override) are excluded from the descriptor list.
 */
export function mapAgeRatingDeclaration(decl: AgeRatingDeclaration | undefined): AscAgeRatingResult {
  const attrs = decl?.attributes ?? {};
  const descriptors: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (AGE_RATING_META_KEYS.has(key)) continue;
    const set = typeof value === "string" ? value !== "" && value !== "NONE" : value === true;
    if (set) descriptors.push(key);
  }
  const result: AscAgeRatingResult = {};
  const rating = normalizeAgeRating(attrs.ageRating);
  if (rating) result.ageRating = rating;
  if (typeof attrs.kindOfAgeRating === "string" && attrs.kindOfAgeRating !== "") {
    result.kindOfAgeRating = attrs.kindOfAgeRating;
  }
  if (descriptors.length > 0) result.contentDescriptors = descriptors;
  return result;
}

/**
 * Read the declared age rating + content descriptors off the app's appInfo
 * resource (a layer SEPARATE from the version localization the write path uses).
 *
 * Steps: GET the appInfo with its ageRatingDeclaration → take the declaration
 * from `included` if Apple inlined it, else GET it directly. Auth is the caller's
 * short-lived ASC JWT (Bearer); the `.p8` never reaches this module and the token
 * never appears in any error.
 *
 * This degrades gracefully: an app with no appInfo, no declaration relationship,
 * or a 404 on the declaration returns `{}` rather than throwing — most apps don't
 * fill this in. Only a genuine auth/permission failure (401/403) or other non-OK
 * on the appInfo list throws, via the token-free ascError.
 */
export async function readAscAgeRating(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AscAgeRatingResult> {
  const auth = { authorization: `Bearer ${opts.token}` };

  // 1. the appInfo, asking Apple to inline the ageRatingDeclaration.
  const infoRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appInfos?include=ageRatingDeclaration&limit=1`,
    { headers: auth },
  );
  if (!infoRes.ok) throw await ascError(infoRes, "list app infos");
  const infoBody = (await infoRes.json().catch(() => ({}))) as {
    data?: AppInfo[];
    included?: AgeRatingDeclaration[];
  };

  const appInfo = infoBody.data?.[0];
  const declRef = appInfo?.relationships?.ageRatingDeclaration?.data;
  // No appInfo, or no declaration relationship → graceful empty result.
  if (!declRef?.id) return {};

  // 2. prefer the inlined declaration from `included`.
  const inlined = infoBody.included?.find(
    (r) => r.type === "ageRatingDeclarations" && r.id === declRef.id,
  );
  if (inlined) return mapAgeRatingDeclaration(inlined);

  // 3. fallback: fetch the declaration directly. A 404/non-OK here is a degraded
  //    (not fatal) state — the rating just isn't readable, so return empty.
  const declRes = await fetchFn(
    `${ASC_BASE}/ageRatingDeclarations/${encodeURIComponent(declRef.id)}`,
    { headers: auth },
  );
  if (!declRes.ok) return {};
  const declBody = (await declRes.json().catch(() => ({}))) as { data?: AgeRatingDeclaration };
  return mapAgeRatingDeclaration(declBody.data);
}


/** A custom product page (PPO surface) read back from App Store Connect. */
export type AscCustomProductPages = {
  pages: Array<{ id: string; name?: string | undefined; state?: string | undefined }>;
};

/**
 * Read an app's custom product pages — the Product Page Optimization (PPO)
 * surface. These are app-level (not version- or locale-scoped), so this is a
 * single GET /apps/{appId}/appCustomProductPages call mapping data[].attributes.
 *
 * Degrades gracefully: an app with no PPO pages returns { pages: [] } rather
 * than throwing. A non-OK HTTP response becomes a token-free AscWriteError —
 * the JWT is the only credential touched here and never appears in the result
 * or the error. Reads only: no POST/PATCH/DELETE.
 */
export async function readAscCustomProductPages(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AscCustomProductPages> {
  const res = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appCustomProductPages?limit=50`,
    { headers: { authorization: `Bearer ${opts.token}` } },
  );
  if (!res.ok) throw await ascError(res, "list custom product pages");

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id: string; attributes?: { name?: string; state?: string } }>;
  };

  return {
    pages: (body.data ?? []).map((page) => ({
      id: page.id,
      name: page.attributes?.name,
      state: page.attributes?.state,
    })),
  };
}


/** One locale's live copy, keyed by its own locale so callers need no separate map. */
export type LocaleListingCopy = LiveListingCopy & { locale: string };

/**
 * Read EVERY locale's live copy from the app's readable App Store version in one
 * pass — the multi-locale generalization of readAscLocalization. Multi-region apps
 * carry the same metadata in many languages; the audit needs all of them, not just
 * en-US, so it stops guessing at locales it never fetched.
 *
 * Reuses the SAME version fetch + pickReadableVersion selection the single-locale
 * read does (no draft required — a live version is readable), then maps the full
 * data[] of appStoreVersionLocalizations instead of picking one. Each entry carries
 * its own locale. Localizations with no locale are skipped (the locale is the key).
 *
 * Returns [] when the readable version has zero localizations. Throws AscWriteError
 * (token-free) only when the app has no versions at all or a request is non-OK.
 */
export async function readAscAllLocales(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<LocaleListingCopy[]> {
  const auth = { authorization: `Bearer ${opts.token}` };

  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Version[] };
  const version = pickReadableVersion(versions.data ?? []);

  const locsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`,
    { headers: auth },
  );
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locs = (await locsRes.json().catch(() => ({}))) as { data?: Localization[] };

  // #69/#71: name + subtitle live on appInfoLocalizations (app-level), NOT on the
  // version localization. Reading them off `a` always yielded undefined — so the
  // `locale_incomplete` finding falsely fired ("fill your subtitle") on locales
  // that HAVE a subtitle. Pull per-locale name/subtitle from the appInfo layer.
  // Best-effort: an appInfo read failure leaves name/subtitle undefined rather
  // than stranding the (still-useful) version-level fields.
  const appInfoByLocale = new Map<string, { name?: string | undefined; subtitle?: string | undefined }>();
  try {
    const info = await readAscAppInfo(fetchFn, { token: opts.token, appId: opts.appId });
    for (const l of info.locales) appInfoByLocale.set(l.locale, { name: l.name, subtitle: l.subtitle });
  } catch {
    // leave the map empty — name/subtitle stay undefined, never invented
  }

  const out: LocaleListingCopy[] = [];
  for (const loc of locs.data ?? []) {
    const a = loc.attributes ?? {};
    if (!a.locale) continue; // locale is the result key — skip anonymous rows
    const appInfoLoc = appInfoByLocale.get(a.locale);
    out.push({
      locale: a.locale,
      name: appInfoLoc?.name, // from appInfoLocalizations (#69/#71)
      subtitle: appInfoLoc?.subtitle, // from appInfoLocalizations (#69/#71)
      keywords: a.keywords,
      promo: a.promotionalText, // map ASC promotionalText → our promo
      description: a.description,
      whatsNew: a.whatsNew, // release notes (#46)
    });
  }
  return out;
}

/** Turn a non-OK ASC response into a token-free AscWriteError. */
export async function ascError(res: Response, step: string): Promise<AscWriteError> {
  let detail = "";
  try {
    const body = (await res.json()) as { errors?: { detail?: string; title?: string }[] };
    detail = body.errors?.[0]?.detail || body.errors?.[0]?.title || "";
  } catch {
    /* non-JSON body — ignore */
  }
  const suffix = detail ? `: ${detail}` : "";
  return new AscWriteError(`App Store Connect rejected the ${step} (${res.status})${suffix}`);
}

// ── Draft-version creation (#34) ──────────────────────────────────────────────

/**
 * #34: create a DRAFT App Store version (state PREPARE_FOR_SUBMISSION) so an
 * approved proposal has somewhere to land when no editable version exists.
 *
 * This is an OUTWARD WRITE to the user's Apple account: it is only ever called
 * from its own explicitly-clicked per-action route — never automatically, never
 * as a fallback inside the push. ASC errors (e.g. a version-number conflict)
 * surface honestly via AscWriteError.
 */
export async function createAscVersion(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; versionString: string; platform?: string },
): Promise<{ id: string; versionString: string; appStoreState: string }> {
  const res = await fetchFn(`${ASC_BASE}/appStoreVersions`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "appStoreVersions",
        attributes: { versionString: opts.versionString, platform: opts.platform ?? "IOS" },
        relationships: { app: { data: { type: "apps", id: opts.appId } } },
      },
    }),
  });
  if (!res.ok) throw await ascError(res, "create app store version");
  const body = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; attributes?: { versionString?: string; appStoreState?: string } };
  };
  return {
    id: body.data?.id ?? "",
    versionString: body.data?.attributes?.versionString ?? opts.versionString,
    appStoreState: body.data?.attributes?.appStoreState ?? "PREPARE_FOR_SUBMISSION",
  };
}

/** Loose Apple version-string check (1 / 1.2 / 1.2.3, numeric segments). */
export function isValidVersionString(v: string): boolean {
  return /^\d+(\.\d+){0,2}$/.test(v.trim());
}
