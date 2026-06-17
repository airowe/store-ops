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

type Version = { id: string; attributes?: { appStoreState?: string } };
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
  };
};

/** The current live copy read back from App Store Connect, shaped like CopyFields. */
export type LiveListingCopy = {
  name?: string | undefined;
  subtitle?: string | undefined;
  keywords?: string | undefined;
  promo?: string | undefined;
  description?: string | undefined;
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
  return {
    data: { type: "appStoreVersionLocalizations", id: localizationId, attributes },
  };
}

// ── HTTP orchestration (thin glue over the pure builders above) ──────────────

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

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
  // map ASC attribute names → our CopyFields shape (promotionalText → promo)
  return {
    name: a.name,
    subtitle: a.subtitle,
    keywords: a.keywords,
    promo: a.promotionalText,
    description: a.description,
  };
}

/** Turn a non-OK ASC response into a token-free AscWriteError. */
async function ascError(res: Response, step: string): Promise<AscWriteError> {
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
