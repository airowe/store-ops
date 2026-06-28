/**
 * App Store `StoreAdapter` — wraps the existing iTunes-based resolution + lookup
 * behind the store-agnostic `StoreAdapter` interface, so the orchestrator can
 * drive iOS through the SAME seam it drives Google Play. No iOS behavior changes;
 * this is an adapter over `resolveAppQuery` + the public iTunes lookup.
 *
 * Honesty: the public iTunes API can't return the subtitle or keyword field, so
 * those map to `null` (UNMEASURED, never a fabricated empty), and `reliable` is
 * `false` (an empty screenshot set is UNKNOWN, not zero — #41).
 */
import { ITUNES_LOOKUP_URL } from "./constants.js";
import {
  type FetchFn,
  type ItunesResult,
  asResponse,
  buildUrl,
  fetchJson,
} from "./itunes.js";
import { resolveAppQuery } from "./resolveApp.js";
import { APP_STORE_PROFILE } from "./store/profiles.js";
import type { NormalizedListing, ScreenshotGroup, StoreAdapter } from "./store/types.js";

/** Map a public iTunes lookup result → the store-agnostic NormalizedListing. */
export function mapItunesToListing(
  appId: string,
  r: ItunesResult | undefined,
): NormalizedListing {
  const screenshots: ScreenshotGroup[] = [];
  if (r?.screenshotUrls && r.screenshotUrls.length > 0) {
    screenshots.push({ family: "iphone", urls: r.screenshotUrls });
  }
  if (r?.ipadScreenshotUrls && r.ipadScreenshotUrls.length > 0) {
    screenshots.push({ family: "ipad", urls: r.ipadScreenshotUrls });
  }
  const genre = r?.genres?.[0];
  return {
    store: "appstore",
    appId,
    title: r?.trackName ?? null,
    // The public iTunes API does NOT expose the subtitle or keyword field — they
    // are UNMEASURED here (a connected App Store Connect read would fill them).
    tagline: null,
    keywordField: null,
    longDescription: r?.description ?? null,
    screenshots,
    category: genre ? { id: genre, name: genre } : null,
    // Public iTunes data: empty ≠ zero (#41).
    reliable: false,
  };
}

/** A `StoreAdapter` for the App Store, backed by a raw `FetchFn` (iTunes). */
export function appStoreAdapter(fetchFn: FetchFn): StoreAdapter {
  return {
    profile: APP_STORE_PROFILE,
    resolve: (query, opts) => resolveAppQuery(fetchFn, query, opts),
    readListing: async (appId, opts) => {
      const country = opts?.country ?? "US";
      const data = asResponse(
        await fetchJson(fetchFn, buildUrl(ITUNES_LOOKUP_URL, { bundleId: appId, country })),
      );
      const r = (data.results ?? [])[0] as ItunesResult | undefined;
      return mapItunesToListing(appId, r);
    },
  };
}
