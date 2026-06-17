/**
 * READ-ONLY App Store Connect screenshot reader (issues #41 / #44).
 *
 * screenshotScore currently scores screenshots pulled from the PUBLIC iTunes
 * Search API, which frequently returns ZERO screenshots for apps that actually
 * ship them — yielding a false "grade ?" (unknown) for real assets. This module
 * reads the GENUINE screenshot graph straight from App Store Connect using the
 * same short-lived JWT the write path uses, so the scorer can flip to
 * `dataReliable: true` and emit a real A–F grade.
 *
 * The graph (all GETs, no writes):
 *   1. GET /apps/{appId}/appStoreVersions            → pick a readable version
 *   2. GET /appStoreVersions/{vid}/appStoreVersionLocalizations → pick locale(s)
 *   3. GET /appStoreVersionLocalizations/{lid}/appScreenshotSets → per-device sets
 *   4. GET /appScreenshotSets/{sid}/appScreenshots   → the actual assets
 *
 * SAFETY: GET only. The JWT is passed per-request via opts.token and is NEVER
 * logged, persisted, or returned. Errors go through ascError, which strips the
 * token. Reuses pickReadableVersion / pickLocalization / ascError from ascWrite.
 */
import {
  ASC_BASE,
  AscWriteError,
  ascError,
  pickLocalization,
  pickReadableVersion,
  type FetchLike,
} from "./ascWrite.js";

/** A single screenshot asset read from ASC. All fields optional — apps vary. */
export type AscScreenshot = {
  id: string;
  /** Image URL template (contains {w}{h}{f}-style placeholders). PUBLIC URL. */
  imageTemplate?: string;
  /** Asset delivery state, e.g. "COMPLETE" / "UPLOAD_INCOMPLETE" — signals readiness. */
  assetDeliveryState?: string;
  width?: number;
  height?: number;
  /** Source file name, when ASC exposes it (e.g. "shot-1.png"). */
  fileName?: string;
};

/** One device's screenshot set (e.g. all 6.7" iPhone shots). */
export type AscScreenshotSetPerDevice = {
  /** The raw ASC screenshotDisplayType, e.g. "APP_IPHONE_67" / "APP_IPAD_PRO_3GEN_129". */
  device: string;
  /** Alias of `device` — the raw ASC screenshotDisplayType (kept for clarity). */
  displayType?: string;
  /** Number of usable screenshots in this set. */
  count: number;
  /** Ordered screenshots in this set. */
  screenshots: AscScreenshot[];
};

export type AscScreenshotSet = {
  /** All iPhone device sizes merged into one array (each preserves its displayType). */
  iphoneScreenshots: AscScreenshotSetPerDevice[];
  /** iPad family sets (iPad, iPad Pro, etc.). */
  ipadScreenshots: AscScreenshotSetPerDevice[];
  /** Hard-coded true: this came from ASC, not the public iTunes API. Closes #44. */
  dataReliable: true;
  /** Raw ASC structure for debugging / future scorers. */
  raw?: {
    /** Un-merged per-device sets (includes "other" surfaces like watch/tv). */
    allSets: AscScreenshotSetPerDevice[];
    versionId?: string;
    localization?: { locale: string; id: string };
  };
};

type DeviceClass = "iphone" | "ipad" | "other";

/** Map an ASC screenshotDisplayType to a device family. */
export function classifyDevice(displayType?: string): DeviceClass {
  if (!displayType) return "other";
  if (displayType.startsWith("APP_IPHONE")) return "iphone";
  if (displayType.startsWith("APP_IPAD")) return "ipad";
  return "other";
}

// ── ASC JSON:API row shapes (only the fields we read) ────────────────────────
type Version = { id: string; attributes?: { appStoreState?: string } };
type Localization = { id: string; attributes?: { locale?: string } };
type ScreenshotSetRow = { id: string; attributes?: { screenshotDisplayType?: string } };
type ScreenshotRow = {
  id: string;
  attributes?: {
    // ASC returns assetDeliveryState as an object { state, errors, warnings }.
    // Be liberal: accept either the object form or a bare string.
    assetDeliveryState?: { state?: string } | string;
    fileName?: string;
    imageAsset?: { templateUrl?: string; width?: number; height?: number };
  };
};

/** Normalize ASC's assetDeliveryState (object or string) to a plain string. */
function deliveryState(raw: ScreenshotRow["attributes"]): string | undefined {
  const s = raw?.assetDeliveryState;
  if (!s) return undefined;
  return typeof s === "string" ? s : s.state;
}

/** Map an ASC screenshot row → our clean AscScreenshot, or null to skip it. */
function mapScreenshot(row: ScreenshotRow): AscScreenshot | null {
  const a = row.attributes ?? {};
  const template = a.imageAsset?.templateUrl;
  // Skip assets with no usable URL (e.g. still uploading) rather than crash.
  if (!template) return null;
  const shot: AscScreenshot = { id: row.id, imageTemplate: template };
  const state = deliveryState(a);
  if (state !== undefined) shot.assetDeliveryState = state;
  if (typeof a.imageAsset?.width === "number") shot.width = a.imageAsset.width;
  if (typeof a.imageAsset?.height === "number") shot.height = a.imageAsset.height;
  if (a.fileName) shot.fileName = a.fileName;
  return shot;
}

/**
 * Read real screenshot metadata from App Store Connect.
 *
 * If `locale` is provided, only that localization's screenshots are read (throws
 * if the locale is absent). If omitted, ALL localizations are aggregated — useful
 * when the audit just wants "does this app have screenshots anywhere".
 *
 * Graceful degradation: a 404 on appScreenshotSets (restricted key, or an app
 * with no sets) yields empty arrays instead of throwing — the scorer can still
 * fall back to the public iTunes API. Auth/permission failures on the version or
 * localization reads DO throw AscWriteError (token stripped).
 */
export async function readAscScreenshots(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; locale?: string },
): Promise<AscScreenshotSet> {
  const auth = { authorization: `Bearer ${opts.token}` };

  // 1. versions → readable one (editable preferred, else live).
  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as { data?: Version[] };
  const version = pickReadableVersion(versions.data ?? []);

  // 2. localizations for that version.
  const locsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,
    { headers: auth },
  );
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locsBody = (await locsRes.json().catch(() => ({}))) as { data?: Localization[] };
  const allLocs = locsBody.data ?? [];

  // Choose the locale(s) to read screenshots from.
  const targetLocs: Localization[] = opts.locale
    ? [pickLocalization(allLocs, opts.locale)] // throws if the locale is missing
    : allLocs;

  // 3 + 4. For each target localization, read its per-device sets and shots.
  const allSets: AscScreenshotSetPerDevice[] = [];
  for (const loc of targetLocs) {
    const sets = await readSetsForLocalization(fetchFn, auth, loc.id);
    allSets.push(...sets);
  }

  const iphoneScreenshots = allSets.filter((s) => classifyDevice(s.device) === "iphone");
  const ipadScreenshots = allSets.filter((s) => classifyDevice(s.device) === "ipad");

  const result: AscScreenshotSet = {
    iphoneScreenshots,
    ipadScreenshots,
    dataReliable: true,
    raw: { allSets, versionId: version.id },
  };
  // Only attach a single localization label when we read exactly one (the common
  // single-locale audit path); aggregated multi-locale reads leave it undefined.
  if (opts.locale && targetLocs[0]) {
    result.raw!.localization = { locale: opts.locale, id: targetLocs[0].id };
  }
  return result;
}

/**
 * Read the per-device screenshot sets for one localization, fetching each set's
 * screenshots. Returns only non-empty sets (a set with 0 usable shots is dropped).
 *
 * A 4xx on the sets list (restricted key / no sets) degrades to [] — we never let
 * a missing-screenshots condition abort the whole audit.
 */
async function readSetsForLocalization(
  fetchFn: FetchLike,
  auth: { authorization: string },
  localizationId: string,
): Promise<AscScreenshotSetPerDevice[]> {
  const setsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`,
    { headers: auth },
  );
  // Graceful degrade: a non-OK sets response means "no readable sets here".
  if (!setsRes.ok) return [];
  const setsBody = (await setsRes.json().catch(() => ({}))) as { data?: ScreenshotSetRow[] };
  const setRows = setsBody.data ?? [];

  const out: AscScreenshotSetPerDevice[] = [];
  for (const setRow of setRows) {
    const device = setRow.attributes?.screenshotDisplayType ?? "UNKNOWN";
    const shotsRes = await fetchFn(
      `${ASC_BASE}/appScreenshotSets/${setRow.id}/appScreenshots?limit=50`,
      { headers: auth },
    );
    if (!shotsRes.ok) continue; // skip a set we can't read; keep the rest
    const shotsBody = (await shotsRes.json().catch(() => ({}))) as { data?: ScreenshotRow[] };
    const screenshots = (shotsBody.data ?? [])
      .map(mapScreenshot)
      .filter((s): s is AscScreenshot => s !== null);
    if (screenshots.length === 0) continue; // omit empty sets (count: 0)
    out.push({ device, displayType: device, count: screenshots.length, screenshots });
  }
  return out;
}

// ── readAscPreviews: preview VIDEOS per device (issue: preview audit) ───────

/** A device's preview videos, grouped by `previewType` (e.g. APP_IPHONE_67). */
export type AscPreviewDevice = {
  /** ASC `previewType` — the device family, e.g. "APP_IPHONE_67". */
  previewType: string;
  /** Number of preview videos uploaded for this device. */
  count: number;
  /** `attributes.previewUrl` per video (omitted while still uploading). */
  urls: string[];
  /** `assetDeliveryState.state` per video ("COMPLETE", "PROCESSING", "FAILED"…). */
  assetState: string[];
  /** First asset error code seen on this device, if any (e.g. PREVIEW_GENERATION_FAILED). */
  errorMsg?: string;
};

export type AscPreviewsResult = {
  /** Every device type with at least one preview video on the chosen localization. */
  devices: AscPreviewDevice[];
  /** The locale actually read (the requested one, or the first available). */
  usedLocale?: string;
};

// ── JSON:API shapes (only the fields we read) ────────────────────────────────

type RelData = { id: string; type?: string };
type Relationship = { data?: RelData[] };

type PreviewLocalization = {
  id: string;
  attributes?: { locale?: string };
  relationships?: { appPreviewSets?: Relationship };
};

type PreviewSet = {
  id: string;
  attributes?: { previewType?: string };
  relationships?: { appPreviews?: Relationship };
};

/** ASC asset state is `{ state, errors? }` in modern responses, a bare string in older ones. */
type AssetDeliveryState = string | { state?: string; errors?: { code?: string; description?: string }[] };

type Preview = {
  id: string;
  type?: string;
  attributes?: {
    previewUrl?: string;
    assetDeliveryState?: AssetDeliveryState;
    fileSize?: number;
    mimeType?: string;
  };
};

type Collection<T> = { data?: T[]; included?: Preview[] };

/** Normalise the two `assetDeliveryState` shapes into { state, error }. */
function readAssetState(raw: AssetDeliveryState | undefined): { state: string | undefined; error: string | undefined } {
  if (typeof raw === "string") return { state: raw, error: undefined };
  if (raw && typeof raw === "object") {
    const error = raw.errors?.[0]?.code || raw.errors?.[0]?.description || undefined;
    return { state: raw.state, error };
  }
  return { state: undefined, error: undefined };
}

/**
 * Read preview VIDEOS per device for an app's version localization.
 *
 * Traversal:
 *   1. GET /apps/{appId}/appStoreVersions             → pickReadableVersion
 *   2. GET /appStoreVersions/{vid}/...Localizations   → requested locale, else first
 *   3. GET /appStoreVersionLocalizations/{lid}/appPreviewSets
 *   4. GET /appPreviewSets/{sid}/appPreviews          (skipped if inlined in included[])
 *
 * Permission-degrades: if step 3 returns 403/404 (the key's role can't read
 * preview sets) the result is empty `devices: []` rather than a thrown error,
 * so the audit reports "preview videos unavailable" instead of crashing.
 *
 * Throws AscWriteError (token-free) only for: no versions, a missing requested
 * locale, or an unexpected non-OK on the versions/localizations reads.
 */
export async function readAscPreviews(
  fetchFn: FetchLike,
  opts: { token: string; appId: string; locale?: string },
): Promise<AscPreviewsResult> {
  const auth = { authorization: `Bearer ${opts.token}` };

  // 1. versions → readable one (live is fine; only writes need an editable version)
  const versionsRes = await fetchFn(
    `${ASC_BASE}/apps/${encodeURIComponent(opts.appId)}/appStoreVersions?limit=50`,
    { headers: auth },
  );
  if (!versionsRes.ok) throw await ascError(versionsRes, "list app store versions");
  const versions = (await versionsRes.json().catch(() => ({}))) as {
    data?: { id: string; attributes?: { appStoreState?: string } }[];
  };
  const version = pickReadableVersion(versions.data ?? []);

  // 2. localizations → requested locale (throws if absent) or first available
  const locsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,
    { headers: auth },
  );
  if (!locsRes.ok) throw await ascError(locsRes, "list version localizations");
  const locs = (await locsRes.json().catch(() => ({}))) as { data?: PreviewLocalization[] };
  const all = locs.data ?? [];
  const localization = opts.locale ? pickLocalization(all, opts.locale) : all[0];
  if (!localization) {
    return { devices: [] };
  }
  const usedLocale = localization.attributes?.locale;

  // 3. preview sets for the localization — permission-degrade on 403/404
  const setsRes = await fetchFn(
    `${ASC_BASE}/appStoreVersionLocalizations/${localization.id}/appPreviewSets?limit=50`,
    { headers: auth },
  );
  if (setsRes.status === 403 || setsRes.status === 404) {
    return usedLocale === undefined ? { devices: [] } : { devices: [], usedLocale };
  }
  if (!setsRes.ok) throw await ascError(setsRes, "list app preview sets");
  const setsBody = (await setsRes.json().catch(() => ({}))) as Collection<PreviewSet>;
  const sets = setsBody.data ?? [];

  const devices: AscPreviewDevice[] = [];
  for (const set of sets) {
    const previewType = set.attributes?.previewType;
    if (!previewType) continue;
    const relIds = set.relationships?.appPreviews?.data ?? [];
    if (relIds.length === 0) continue; // empty set → count 0, omit

    const previews = await resolvePreviews(fetchFn, auth, set, setsBody.included);
    if (previews.length === 0) continue;

    const urls: string[] = [];
    const assetState: string[] = [];
    let errorMsg: string | undefined;
    for (const p of previews) {
      const url = p.attributes?.previewUrl;
      if (url) urls.push(url);
      const { state, error } = readAssetState(p.attributes?.assetDeliveryState);
      if (state) assetState.push(state);
      if (error && !errorMsg) errorMsg = error;
    }

    const device: AscPreviewDevice = { previewType, count: previews.length, urls, assetState };
    if (errorMsg) device.errorMsg = errorMsg;
    devices.push(device);
  }

  return usedLocale === undefined ? { devices } : { devices, usedLocale };
}

/**
 * Resolve a set's appPreviews — prefer ones inlined in `included[]` (saves a
 * round-trip), else GET /appPreviewSets/{id}/appPreviews. A 403/404 on the
 * per-set fetch degrades to an empty list (the set is simply skipped).
 */
async function resolvePreviews(
  fetchFn: FetchLike,
  auth: { authorization: string },
  set: PreviewSet,
  included: Preview[] | undefined,
): Promise<Preview[]> {
  const relIds = set.relationships?.appPreviews?.data ?? [];
  if (included && included.length > 0) {
    const wanted = new Set(relIds.map((r) => r.id));
    const inlined = included.filter((i) => i.type === "appPreviews" && wanted.has(i.id));
    if (inlined.length > 0) return inlined;
  }

  const res = await fetchFn(`${ASC_BASE}/appPreviewSets/${set.id}/appPreviews?limit=50`, {
    headers: auth,
  });
  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) throw await ascError(res, "list app previews");
  const body = (await res.json().catch(() => ({}))) as { data?: Preview[] };
  return body.data ?? [];
}

// ── readAscPricingAndIAP: in-app purchases + price schedule ─────────────────

/** A single in-app purchase as exposed by /inAppPurchasesV2. Every field is
 *  optional except the ASC id, because apps vary and ASC may omit attributes. */
export type InAppPurchase = {
  id: string;
  name?: string;
  productId?: string;
  /** e.g. ACTIVE | APPROVED | MISSING_METADATA | DEVELOPER_ACTION_NEEDED */
  state?: string;
  /** CONSUMABLE | NON_CONSUMABLE | AUTO_RENEWABLE_SUBSCRIPTION | FREE_SUBSCRIPTION | NON_RENEWING_SUBSCRIPTION */
  inAppPurchaseType?: string;
};

export type AppPricing = {
  iaps: InAppPurchase[];
  pricing: {
    /** Human display string, e.g. "0.99 USD", or null if unresolvable. */
    priceTier: string | null;
    /** Numeric base-territory customer price, e.g. 0.99, or null. */
    baseTerritoryPrice: number | null;
    /** Base territory id, e.g. "USA", or null. */
    baseTerritory: string | null;
  };
  /** Token-free audit notes for any endpoint that degraded. Absent when all OK. */
  notes?: string[];
};

// ── JSON:API shapes (only the fields we read) ────────────────────────────────

type Rel = { data?: { id?: string; type?: string } | { id?: string; type?: string }[] };
type Resource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, Rel | undefined>;
};
type ListBody = { data?: Resource[] };
type SingleBody = { data?: Resource; included?: Resource[] };

// ── Pure mappers ─────────────────────────────────────────────────────────────

/** Map a JSON:API inAppPurchases resource to our InAppPurchase, dropping any
 *  attribute ASC omitted (so the shape stays clean rather than full of undefineds). */
export function mapInAppPurchase(resource: Resource): InAppPurchase {
  const a = resource.attributes ?? {};
  const iap: InAppPurchase = { id: String(resource.id ?? "") };
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const name = str(a.name);
  const productId = str(a.productId);
  const state = str(a.state);
  const inAppPurchaseType = str(a.inAppPurchaseType);
  if (name !== undefined) iap.name = name;
  if (productId !== undefined) iap.productId = productId;
  if (state !== undefined) iap.state = state;
  if (inAppPurchaseType !== undefined) iap.inAppPurchaseType = inAppPurchaseType;
  return iap;
}

function relId(rel: Rel | undefined): string | undefined {
  const d = rel?.data;
  if (!d || Array.isArray(d)) return Array.isArray(d) ? d[0]?.id : undefined;
  return d.id;
}

/**
 * Resolve the base-territory price from an appPriceSchedule single response.
 *
 * Strategy: find the base territory id, then look for the appPricePoint in
 * `included[]` whose territory relationship matches it (or, failing a match,
 * the first appPricePoint present). Returns nulls — never undefined — so the
 * audit shape is stable even on a sparse schedule.
 */
export function resolvePriceSchedule(body: SingleBody): {
  priceTier: string | null;
  baseTerritoryPrice: number | null;
  baseTerritory: string | null;
} {
  const empty = { priceTier: null, baseTerritoryPrice: null, baseTerritory: null };
  const data = body.data;
  if (!data) return empty;

  const baseTerritory = relId(data.relationships?.baseTerritory) ?? null;
  const included = body.included ?? [];
  const pricePoints = included.filter((r) => r.type === "appPricePoints");
  if (pricePoints.length === 0) return { ...empty, baseTerritory };

  // Prefer the price point tied to the base territory; otherwise take the first.
  const match =
    (baseTerritory && pricePoints.find((p) => relId(p.relationships?.territory) === baseTerritory)) ||
    pricePoints[0];
  const customerPrice = match?.attributes?.customerPrice;
  const priceNum = typeof customerPrice === "string" ? Number(customerPrice) : typeof customerPrice === "number" ? customerPrice : NaN;
  const baseTerritoryPrice = Number.isFinite(priceNum) ? priceNum : null;

  // Currency comes from the matching territory resource (if included).
  const territoryId = relId(match?.relationships?.territory) ?? baseTerritory ?? undefined;
  const territory = territoryId ? included.find((r) => r.type === "territories" && r.id === territoryId) : undefined;
  const currency = typeof territory?.attributes?.currency === "string" ? territory.attributes.currency : undefined;

  const priceTier =
    baseTerritoryPrice !== null
      ? currency
        ? `${customerPrice} ${currency}`
        : String(customerPrice)
      : null;

  return { priceTier, baseTerritoryPrice, baseTerritory };
}

// ── HTTP orchestration (degrades gracefully; never throws on 4xx) ────────────

/**
 * Read in-app purchases (/inAppPurchasesV2) and the app's price schedule
 * (/appPriceSchedule) for an app. READ-ONLY. If either endpoint is unavailable
 * on the token scope (403) or unconfigured (404 / any non-OK), that surface
 * degrades to empty and a token-free note is recorded — the whole run continues.
 */
export async function readAscPricingAndIAP(
  fetchFn: FetchLike,
  opts: { token: string; appId: string },
): Promise<AppPricing> {
  const auth = { authorization: `Bearer ${opts.token}` };
  const appId = encodeURIComponent(opts.appId);
  const notes: string[] = [];

  // 1. In-app purchases — list all (limit=200).
  let iaps: InAppPurchase[] = [];
  const iapsRes = await fetchFn(`${ASC_BASE}/apps/${appId}/inAppPurchasesV2?limit=200`, { headers: auth });
  if (iapsRes.ok) {
    const body = (await iapsRes.json().catch(() => ({}))) as ListBody;
    iaps = (body.data ?? []).map(mapInAppPurchase);
  } else {
    notes.push(noteFor(iapsRes.status, "in-app purchases"));
  }

  // 2. Price schedule — base territory + price points.
  let pricing: AppPricing["pricing"] = { priceTier: null, baseTerritoryPrice: null, baseTerritory: null };
  const priceRes = await fetchFn(
    `${ASC_BASE}/apps/${appId}/appPriceSchedule?include=baseTerritory,manualPrices`,
    { headers: auth },
  );
  if (priceRes.ok) {
    const body = (await priceRes.json().catch(() => ({}))) as SingleBody;
    pricing = resolvePriceSchedule(body);
  } else {
    notes.push(noteFor(priceRes.status, "app price schedule"));
  }

  const result: AppPricing = { iaps, pricing };
  if (notes.length > 0) result.notes = notes;
  return result;
}

/** Token-free degradation note for a non-OK read. Mirrors ascError's wording
 *  but does NOT throw — pricing reads are best-effort, not run-blocking. */
function noteFor(status: number, surface: string): string {
  if (status === 403) return `App Store Connect denied the ${surface} read (403) — this key may lack the required scope.`;
  if (status === 404) return `No ${surface} configured for this app (404).`;
  return `App Store Connect rejected the ${surface} read (${status}).`;
}

// Re-export for callers that want one import site.
export { AscWriteError, type FetchLike };
