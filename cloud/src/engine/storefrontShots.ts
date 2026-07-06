/**
 * Storefront screenshot fallback (#41 follow-up): Apple's public lookup API
 * frequently returns EMPTY screenshot arrays for apps that have them (small /
 * recently-shipped apps especially). The public storefront page, however,
 * embeds the real screenshot set in its `serialized-server-data` JSON —
 * shelfMapping keys like `product_media_phone_` / `product_media_pad_` carry
 * `items[].screenshot.template` URLs plus native dimensions.
 *
 * Pure extraction over fetched HTML; returns null (never throws) when the page
 * doesn't carry the structure, so the audit safe-degrades to the honest
 * "unknown, connect ASC" state it shows today.
 */
import { USER_AGENT } from "./constants.js";
import type { FetchFn } from "./itunes.js";

export type StorefrontShots = {
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
};

/** The slice of the shelf structure we read. */
type Shelf = { items?: Array<{ screenshot?: { template?: unknown } }> };

const BLOB_RE =
  /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/;

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
    const template = item?.screenshot?.template;
    if (typeof template === "string" && template.includes("{w}x{h}")) {
      out.push(normalizeTemplate(template));
    }
  }
  return out;
}

/** Extract the screenshot set from a storefront product page's HTML. */
export function extractStorefrontShots(html: string): StorefrontShots | null {
  const blob = BLOB_RE.exec(html)?.[1];
  if (!blob) return null;
  let shelfMapping: Record<string, Shelf>;
  try {
    const data = JSON.parse(blob) as {
      data?: Array<{ data?: { shelfMapping?: Record<string, Shelf> } }>;
    };
    const mapping = (data.data ?? [])
      .map((d) => d?.data?.shelfMapping)
      .find((m) => m && typeof m === "object");
    if (!mapping) return null;
    shelfMapping = mapping;
  } catch {
    return null;
  }

  const iphone: string[] = [];
  const ipad: string[] = [];
  for (const [key, shelf] of Object.entries(shelfMapping)) {
    if (key.startsWith("product_media_phone")) iphone.push(...shotsFromShelf(shelf));
    else if (key.startsWith("product_media_pad")) ipad.push(...shotsFromShelf(shelf));
  }
  // An empty result is indistinguishable from "structure changed" — report null
  // so callers keep the honest unknown state instead of asserting "no shots".
  if (iphone.length === 0 && ipad.length === 0) return null;
  return { screenshotUrls: iphone, ipadScreenshotUrls: ipad };
}

/** Fetch a storefront page and extract its screenshots. Null on any failure. */
export async function fetchStorefrontShots(
  fetchFn: FetchFn,
  trackViewUrl: string,
): Promise<StorefrontShots | null> {
  try {
    const resp = await fetchFn(trackViewUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!resp.ok) return null;
    return extractStorefrontShots(await resp.text());
  } catch {
    return null;
  }
}
