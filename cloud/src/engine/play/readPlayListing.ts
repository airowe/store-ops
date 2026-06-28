/**
 * "Our own" Google Play data provider — the READ layer.
 *
 * Fetches a Play detail page (via the injected `PlayPageSource`), parses it, and
 * maps the result into the store-agnostic `NormalizedListing` the shared engine
 * consumes. The mapping carries the honesty contract verbatim:
 *   • `keywordField` is ALWAYS null — Play has no keyword field (structurally
 *     absent, never "empty").
 *   • `tagline` (the 80-char short description) is null here — it isn't in the
 *     ld+json/OG surface we read, so it's honestly UNMEASURED, not blank.
 *   • `reliable: false` — this is scraped public data, so an empty screenshot /
 *     field set means UNKNOWN, not zero (the #41 discipline that makes the
 *     screenshot scorer grade "?" instead of a false "F").
 */
import type { NormalizedListing } from "../store/types.js";
import { type PlayDetailRaw, parsePlayDetail } from "./playListingParse.js";
import type { PlayPageOpts, PlayPageSource } from "./playWebSource.js";

/**
 * Map the raw parsed Play fields → a `NormalizedListing`. PURE (no fetch), so it
 * unit-tests against a fixed `PlayDetailRaw`. The honesty rules above live HERE,
 * in one place, so every caller gets them.
 */
export function mapPlayDetailToListing(raw: PlayDetailRaw): NormalizedListing {
  return {
    store: "googleplay",
    appId: raw.packageName,
    title: raw.title,
    // Play's separate short description isn't in the standards-based surface we
    // read — honestly unmeasured here, never a fabricated blank.
    tagline: null,
    // Play has NO keyword field — absent, not empty.
    keywordField: null,
    longDescription: raw.description,
    // ld+json `screenshot` is a flat list with no device-family split; we attach
    // it to the primary "phone" family. Per-family screenshots need the deeper
    // `ds:` data (deferred) — until then tablet families are honestly absent.
    screenshots: raw.screenshots.length > 0 ? [{ family: "phone", urls: raw.screenshots }] : [],
    category: raw.category ? { id: raw.category, name: raw.category } : null,
    // Scraped public data: empty ≠ zero (#41).
    reliable: false,
  };
}

/**
 * Read one Play listing by package id → `NormalizedListing`. The only impure
 * step (the page fetch) goes through the injected source, so the whole thing
 * tests with a fake source and zero network.
 */
export async function readPlayListing(
  source: PlayPageSource,
  packageName: string,
  opts: PlayPageOpts = {},
): Promise<NormalizedListing> {
  const html = await source.detail(packageName, opts);
  return mapPlayDetailToListing(parsePlayDetail(html, packageName));
}
