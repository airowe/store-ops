/**
 * Populate the weekly digest's card from an app's PUBLIC App Store listing.
 *
 * Uses the free iTunes Lookup — no credentials — so the card works for every
 * app on every tier, including free. The audit already reads this endpoint;
 * this is the same data shaped for the email.
 *
 * Two rules:
 *
 * 1. **Absent means absent.** A field Apple did not return is left `undefined`
 *    and the renderer omits it. Never default — a missing rating rendered as
 *    "0.0 ★ (0)" would read as a real and terrible rating, which is exactly the
 *    measured-or-nothing failure the product exists to avoid.
 *
 * 2. **A card is never worth a lost digest.** Any lookup failure returns
 *    `undefined`, and the digest sends as text. The rank data is the point; the
 *    card is decoration.
 */
import { ITUNES_LOOKUP_URL } from "./constants.js";
import { asResponse, buildUrl, fetchJson, type FetchFn } from "./itunes.js";
import { resolveShotUrl } from "./screenshotScore.js";
import type { DigestCard } from "../digest.js";

/**
 * Build the card for one app, or `undefined` when the listing can't be read.
 * Never throws.
 */
export async function digestCardFor(
  fetchFn: FetchFn,
  bundleId: string,
  country: string,
): Promise<DigestCard | undefined> {
  let result;
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { bundleId, country });
    const data = await fetchJson(fetchFn, url);
    result = asResponse(data).results?.[0];
  } catch {
    return undefined; // network/parse failure — send the digest without a card
  }
  if (!result) return undefined;

  // Apple returns artwork at several sizes and not always the largest; take the
  // biggest available. The email renders it at 44px, so any of these is ample.
  const r = result as typeof result & {
    artistName?: string;
    artworkUrl512?: string;
    artworkUrl100?: string;
    artworkUrl60?: string;
  };
  const iconUrl = r.artworkUrl512 ?? r.artworkUrl100 ?? r.artworkUrl60;

  // A rating needs BOTH halves to mean anything: an average with no count is
  // unanchored, and a count with no average has nothing to show.
  const rating =
    typeof r.averageUserRating === "number" && typeof r.userRatingCount === "number"
      ? { average: r.averageUserRating, count: r.userRatingCount }
      : undefined;

  // Apple's URLs carry an UNSUBSTITUTED {w}x{h}bb.{f} size template. Left raw in
  // an <img src> the browser percent-encodes the braces and the CDN 404s — every
  // screenshot silently breaks. resolveShotUrl substitutes real dimensions.
  const shots = r.screenshotUrls?.length
    ? r.screenshotUrls.map(resolveShotUrl)
    : undefined;

  return {
    ...(iconUrl ? { iconUrl } : {}),
    ...(r.artistName ? { developer: r.artistName } : {}),
    ...(r.version ? { version: r.version } : {}),
    ...(r.primaryGenreName ? { category: r.primaryGenreName } : {}),
    ...(r.formattedPrice ? { price: r.formattedPrice } : {}),
    ...(rating ? { rating } : {}),
    ...(shots ? { screenshotUrls: shots } : {}),
  };
}
