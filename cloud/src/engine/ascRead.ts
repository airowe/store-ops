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

// Re-export for callers that want one import site.
export { AscWriteError, type FetchLike };
