/**
 * Storefront listing extraction — the public product page carries far more
 * than Apple's lookup API returns: the SUBTITLE (lookup never has it), the
 * ratings histogram, What's New text, privacy nutrition labels, languages,
 * IAP names+prices, Apple's own similar-apps graph, the seller's other apps,
 * and the screenshot set (which lookup frequently omits — #41).
 *
 * One fetch, one parse pass, a typed bundle where EVERY field is optional and
 * extracted independently: a structure drift in one shelf degrades that field
 * to absent, never the whole read. `null` only when the page carries no
 * readable serialized-server-data at all.
 *
 * Supersedes storefrontShots.ts (the screenshot-only first cut).
 */
import { USER_AGENT } from "./constants.js";
import type { FetchFn } from "./itunes.js";

export type StorefrontShots = {
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
};

export type StorefrontApp = {
  bundleId: string;
  name: string;
  subtitle?: string;
  rating?: number;
  ratingCount?: number;
};

export type StorefrontListing = {
  /** The listing subtitle — public, but absent from the lookup API. */
  subtitle?: string;
  /** Average, total count, and the 1→5-star histogram. */
  ratings?: { average: number; count: number; histogram: number[] };
  /** Most recent version's What's New text. */
  whatsNew?: string;
  /** Privacy nutrition label identifiers, e.g. "DATA_NOT_COLLECTED". */
  privacyLabels?: string[];
  /** Listed languages, e.g. ["English"]. */
  languages?: string[];
  category?: string;
  inAppPurchases?: Array<{ name: string; price: string }>;
  /** Apple's "You Might Also Like" graph — a competitor-discovery signal. */
  similarApps?: StorefrontApp[];
  /** The seller's other apps — portfolio auto-detection. */
  moreByDeveloper?: StorefrontApp[];
  /** Screenshot sets (the #41 lookup-omission fallback). */
  shots?: StorefrontShots;
};

/* ── internal shapes (the slices we read; everything else is ignored) ────── */

type Shelf = { items?: unknown[] };
type ShelfMapping = Record<string, Shelf>;

const BLOB_RE = /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/;

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() !== "" ? x : undefined;
}

/* ── per-field extractors — each returns undefined on any surprise ────────── */

/**
 * Normalize Apple's size-token template tail ("{w}x{h}{c}.{f}" on storefront
 * pages, "{w}x{h}bb.{f}" elsewhere) to the `{w}x{h}bb.png` form the scorer's
 * `resolveShotUrl` already substitutes into a loadable URL.
 */
function normalizeTemplate(template: string): string {
  return template.replace(/\{w\}x\{h\}[^/]*$/, "{w}x{h}bb.png");
}

function shotsFromShelf(shelf: Shelf): string[] {
  const out: string[] = [];
  for (const item of shelf.items ?? []) {
    const template = asRecord(asRecord(item)?.screenshot)?.template;
    if (typeof template === "string" && template.includes("{w}x{h}")) {
      out.push(normalizeTemplate(template));
    }
  }
  return out;
}

function extractShots(mapping: ShelfMapping): StorefrontShots | undefined {
  const iphone: string[] = [];
  const ipad: string[] = [];
  for (const [key, shelf] of Object.entries(mapping)) {
    if (key.startsWith("product_media_phone")) iphone.push(...shotsFromShelf(shelf));
    else if (key.startsWith("product_media_pad")) ipad.push(...shotsFromShelf(shelf));
  }
  // Empty is indistinguishable from "structure changed" — report absent so
  // callers keep the honest unknown state instead of asserting "no shots".
  if (iphone.length === 0 && ipad.length === 0) return undefined;
  return { screenshotUrls: iphone, ipadScreenshotUrls: ipad };
}

function extractRatings(mapping: ShelfMapping): StorefrontListing["ratings"] {
  const item = asRecord(mapping["productRatings"]?.items?.[0]);
  if (!item) return undefined;
  const average = item["ratingAverage"];
  const count = item["totalNumberOfRatings"];
  const histogram = item["ratingCounts"];
  if (typeof average !== "number" || typeof count !== "number") return undefined;
  return {
    average,
    count,
    histogram: Array.isArray(histogram) && histogram.every((n) => typeof n === "number")
      ? (histogram as number[])
      : [],
  };
}

function extractWhatsNew(mapping: ShelfMapping): string | undefined {
  return asString(asRecord(mapping["mostRecentVersion"]?.items?.[0])?.text);
}

function extractPrivacyLabels(mapping: ShelfMapping): string[] | undefined {
  const labels: string[] = [];
  for (const item of mapping["privacyTypes"]?.items ?? []) {
    const id = asString(asRecord(item)?.identifier);
    if (id) labels.push(id);
  }
  return labels.length > 0 ? labels : undefined;
}

/** The `information` shelf is a titled annotation list (Seller/Category/…). */
function informationItems(mapping: ShelfMapping, title: string): Record<string, unknown> | null {
  for (const item of mapping["information"]?.items ?? []) {
    const rec = asRecord(item);
    if (rec?.title === title) return rec;
  }
  return null;
}

function annotationTexts(entry: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  for (const item of (entry?.items as unknown[] | undefined) ?? []) {
    const text = asString(asRecord(item)?.text);
    if (text) out.push(text);
  }
  return out;
}

function extractLanguages(mapping: ShelfMapping): string[] | undefined {
  const texts = annotationTexts(informationItems(mapping, "Languages"));
  const langs = texts.flatMap((t) => t.split(",").map((s) => s.trim())).filter(Boolean);
  return langs.length > 0 ? langs : undefined;
}

function extractCategory(mapping: ShelfMapping): string | undefined {
  return annotationTexts(informationItems(mapping, "Category"))[0];
}

function extractIaps(mapping: ShelfMapping): Array<{ name: string; price: string }> | undefined {
  const entry = informationItems(mapping, "In-App Purchases");
  const out: Array<{ name: string; price: string }> = [];
  for (const item of (entry?.items as unknown[] | undefined) ?? []) {
    for (const pair of (asRecord(item)?.textPairs as unknown[] | undefined) ?? []) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
        out.push({ name: pair[0], price: pair[1] });
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

function lockupApps(mapping: ShelfMapping, key: string): StorefrontApp[] | undefined {
  const out: StorefrontApp[] = [];
  for (const item of mapping[key]?.items ?? []) {
    const rec = asRecord(item);
    const bundleId = asString(rec?.bundleId);
    const name = asString(rec?.title);
    if (!bundleId || !name) continue;
    const subtitle = asString(rec?.subtitle);
    const rating = typeof rec?.rating === "number" ? rec.rating : undefined;
    const ratingCount = typeof rec?.ratingCount === "number" ? rec.ratingCount : undefined;
    out.push({
      bundleId,
      name,
      ...(subtitle !== undefined ? { subtitle } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(ratingCount !== undefined ? { ratingCount } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/* ── the one-pass extraction ──────────────────────────────────────────────── */

/** Extract everything we can read from a storefront product page's HTML. */
export function extractStorefrontListing(html: string): StorefrontListing | null {
  const blob = BLOB_RE.exec(html)?.[1];
  if (!blob) return null;

  let page: Record<string, unknown>;
  try {
    const data = JSON.parse(blob) as { data?: Array<{ data?: unknown }> };
    const found = (data.data ?? []).map((d) => asRecord(d?.data)).find((d) => d !== null);
    if (!found) return null;
    page = found;
  } catch {
    return null;
  }

  const mapping = (asRecord(page["shelfMapping"]) ?? {}) as ShelfMapping;
  const subtitle = asString(asRecord(page["lockup"])?.subtitle);
  const ratings = extractRatings(mapping);
  const whatsNew = extractWhatsNew(mapping);
  const privacyLabels = extractPrivacyLabels(mapping);
  const languages = extractLanguages(mapping);
  const category = extractCategory(mapping);
  const inAppPurchases = extractIaps(mapping);
  const similarApps = lockupApps(mapping, "similarItems");
  const moreByDeveloper = lockupApps(mapping, "moreByDeveloper");
  const shots = extractShots(mapping);

  return {
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(ratings !== undefined ? { ratings } : {}),
    ...(whatsNew !== undefined ? { whatsNew } : {}),
    ...(privacyLabels !== undefined ? { privacyLabels } : {}),
    ...(languages !== undefined ? { languages } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(inAppPurchases !== undefined ? { inAppPurchases } : {}),
    ...(similarApps !== undefined ? { similarApps } : {}),
    ...(moreByDeveloper !== undefined ? { moreByDeveloper } : {}),
    ...(shots !== undefined ? { shots } : {}),
  };
}

/** Fetch a storefront page and extract its listing. Null on any failure. */
export async function fetchStorefrontListing(
  fetchFn: FetchFn,
  trackViewUrl: string,
): Promise<StorefrontListing | null> {
  try {
    const resp = await fetchFn(trackViewUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!resp.ok) return null;
    return extractStorefrontListing(await resp.text());
  } catch {
    return null;
  }
}
